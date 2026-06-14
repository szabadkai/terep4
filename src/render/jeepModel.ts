/**
 * Low-poly jeep built by lofting cross-sections along the body — raked nose,
 * angled rocker panels, fender shoulders and a sloped windshield — instead
 * of stacking primitive boxes. One vertex-colored, flat-shaded geometry for
 * the body plus a few small trim meshes for details.
 */

import * as THREE from 'three';
import { COLORS } from '../config';

type Pt = [number, number];

interface Section {
  z: number;
  pts: Pt[];
}

const GLASS = new THREE.Color(COLORS.glass);
const TRIM = new THREE.Color(COLORS.trim);

export interface JeepVisualOptions {
  accentColor?: number;
  variant?: number;
}

class LoftBuilder {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];

  /** Emit a triangle wound so its normal points along `out`. */
  tri(a: number[], b: number[], c: number[], out: number[], color: THREE.Color): void {
    let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (nx * out[0] + ny * out[1] + nz * out[2] < 0) {
      [b, c] = [c, b];
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const len = Math.hypot(nx, ny, nz) || 1;
    for (const p of [a, b, c]) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(nx / len, ny / len, nz / len);
      this.colors.push(color.r, color.g, color.b);
    }
  }

  /**
   * Skin consecutive sections (same point count, rings ordered CCW viewed
   * from +Z). `colorFor(segment, strip)` picks the panel color.
   */
  loft(sections: Section[], colorFor: (seg: number, strip: number) => THREE.Color): void {
    const n = sections[0].pts.length;
    for (let s = 0; s < sections.length - 1; s++) {
      const a = sections[s];
      const b = sections[s + 1];
      // Outward reference: from the centroid of the segment toward each quad.
      const cx = avg(a.pts, 0) / 2 + avg(b.pts, 0) / 2;
      const cy = avg(a.pts, 1) / 2 + avg(b.pts, 1) / 2;
      const cz = (a.z + b.z) / 2;
      for (let j = 0; j < n; j++) {
        const k = (j + 1) % n;
        const p00 = [a.pts[j][0], a.pts[j][1], a.z];
        const p01 = [a.pts[k][0], a.pts[k][1], a.z];
        const p10 = [b.pts[j][0], b.pts[j][1], b.z];
        const p11 = [b.pts[k][0], b.pts[k][1], b.z];
        const mid = [
          (p00[0] + p01[0] + p10[0] + p11[0]) / 4 - cx,
          (p00[1] + p01[1] + p10[1] + p11[1]) / 4 - cy,
          (p00[2] + p01[2] + p10[2] + p11[2]) / 4 - cz,
        ];
        const color = colorFor(s, j);
        this.tri(p00, p01, p11, mid, color);
        this.tri(p00, p11, p10, mid, color);
      }
    }
  }

  /** Close a section ring with a triangle fan facing ±Z. */
  cap(section: Section, dir: 1 | -1, color: THREE.Color): void {
    const out = [0, 0, dir];
    const center = [avg(section.pts, 0), avg(section.pts, 1), section.z];
    const n = section.pts.length;
    for (let j = 0; j < n; j++) {
      const k = (j + 1) % n;
      this.tri(
        center,
        [section.pts[j][0], section.pts[j][1], section.z],
        [section.pts[k][0], section.pts[k][1], section.z],
        out,
        color,
      );
    }
  }

  build(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    return geo;
  }
}

function avg(pts: Pt[], axis: 0 | 1): number {
  return pts.reduce((s, p) => s + p[axis], 0) / pts.length;
}

/** 8-point body ring: tucked bottom, flared shoulder, narrower deck. */
function bodyRing(
  hwB: number,
  hwS: number,
  hwD: number,
  yB: number,
  yMid: number,
  ySh: number,
  yD: number,
): Pt[] {
  const right: Pt[] = [
    [hwB, yB],
    [hwS, yMid],
    [hwS, ySh],
    [hwD, yD],
  ];
  return [...right, ...right.map(([x, y]): Pt => [-x, y]).reverse()];
}

/** 4-point greenhouse ring: trapezoid (glass sides, roof on top). */
function cabinRing(hwB: number, hwT: number, yB: number, yT: number): Pt[] {
  return [
    [hwB, yB],
    [hwT, yT],
    [-hwT, yT],
    [-hwB, yB],
  ];
}

export function buildJeep(
  bodyColor: number = COLORS.body,
  { accentColor = 0xf2d24a, variant = 0 }: JeepVisualOptions = {},
): THREE.Group {
  const group = new THREE.Group();
  const lofts = new LoftBuilder();
  const PAINT = new THREE.Color(bodyColor);

  // Body: nose → grille → cowl → rear → tail. Strips 0/6/7 are the rocker
  // panels and underside (trim); everything else is paint.
  const body: Section[] = [
    { z: 1.95, pts: bodyRing(0.5, 0.66, 0.54, 0.32, 0.44, 0.54, 0.58) },
    { z: 1.5, pts: bodyRing(0.6, 0.84, 0.7, 0.14, 0.32, 0.6, 0.66) },
    { z: 0.48, pts: bodyRing(0.62, 0.86, 0.74, 0.1, 0.3, 0.62, 0.71) },
    { z: -1.45, pts: bodyRing(0.62, 0.86, 0.74, 0.1, 0.3, 0.62, 0.71) },
    { z: -1.95, pts: bodyRing(0.56, 0.8, 0.66, 0.24, 0.38, 0.58, 0.64) },
  ];
  lofts.loft(body, (_seg, strip) => (strip === 0 || strip >= 6 ? TRIM : PAINT));
  lofts.cap(body[0], 1, TRIM); // grille face
  lofts.cap(body[body.length - 1], -1, PAINT); // tailgate

  // Greenhouse: windshield rakes up, roof, sloped rear window.
  const cabin: Section[] = [
    { z: 0.5, pts: cabinRing(0.74, 0.72, 0.69, 0.74) },
    { z: 0.02, pts: cabinRing(0.74, 0.6, 0.69, 1.26) },
    { z: -1.3, pts: cabinRing(0.74, 0.62, 0.69, 1.27) },
    { z: -1.72, pts: cabinRing(0.72, 0.62, 0.69, 0.76) },
  ];
  lofts.loft(cabin, (seg, strip) => (strip === 1 && seg === 1 ? PAINT : GLASS));
  lofts.cap(cabin[cabin.length - 1], -1, GLASS); // rear window

  const bodyMesh = new THREE.Mesh(
    lofts.build(),
    new THREE.MeshLambertMaterial({ vertexColors: true }),
  );
  group.add(bodyMesh);

  // Trim details: bumpers, fender flares, roof rack, mirrors, lights, spare.
  const trimMat = new THREE.MeshLambertMaterial({ color: COLORS.trim, flatShading: true });
  const underMat = new THREE.MeshLambertMaterial({ color: 0x12171b, flatShading: true });
  const accentMat = new THREE.MeshLambertMaterial({ color: accentColor, flatShading: true });
  const plateMat = new THREE.MeshLambertMaterial({ color: 0xe8e2c8, flatShading: true });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };
  const addPart = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    ry = 0,
  ) => {
    const mesh = add(geo, mat, x, y, z);
    mesh.rotation.y = ry;
    return mesh;
  };

  add(new THREE.BoxGeometry(1.56, 0.16, 0.2), trimMat, 0, 0.14, 1.95);
  add(new THREE.BoxGeometry(1.56, 0.16, 0.2), trimMat, 0, 0.18, -1.95);
  const exhaustGeo = new THREE.CylinderGeometry(0.045, 0.055, 0.48, 7);
  exhaustGeo.rotateX(Math.PI / 2);
  const exhaust = add(exhaustGeo, trimMat, 0.52, 0.1, -2.15);
  exhaust.rotation.z = -0.12;
  add(new THREE.BoxGeometry(0.5, 0.12, 0.03), plateMat, 0, 0.34, 2.07);
  add(new THREE.BoxGeometry(0.52, 0.12, 0.03), plateMat, 0, 0.38, -2.07);
  add(new THREE.BoxGeometry(0.05, 0.08, 1.7), accentMat, -0.89, 0.53, -0.35);
  add(new THREE.BoxGeometry(0.05, 0.08, 1.7), accentMat, 0.89, 0.53, -0.35);
  // Undercarriage: visually separates the body from the ground/wheels so
  // jumps and rollovers do not expose a single flat painted slab.
  add(new THREE.BoxGeometry(1.18, 0.1, 2.95), underMat, 0, -0.02, -0.04);
  add(new THREE.BoxGeometry(0.1, 0.18, 3.26), trimMat, -0.54, -0.08, -0.04);
  add(new THREE.BoxGeometry(0.1, 0.18, 3.26), trimMat, 0.54, -0.08, -0.04);
  add(new THREE.BoxGeometry(1.68, 0.08, 0.1), trimMat, 0, -0.18, 1.32);
  add(new THREE.BoxGeometry(1.68, 0.08, 0.1), trimMat, 0, -0.18, -1.32);
  add(new THREE.BoxGeometry(0.44, 0.22, 0.34), underMat, 0, -0.12, 1.32);
  add(new THREE.BoxGeometry(0.44, 0.22, 0.34), underMat, 0, -0.12, -1.32);
  for (const sx of [-1, 1]) {
    for (const z of [1.32, -1.32]) {
      addPart(new THREE.BoxGeometry(0.62, 0.06, 0.08), trimMat, sx * 0.36, -0.16, z, sx * 0.28);
      add(new THREE.BoxGeometry(0.46, 0.26, 0.86), underMat, sx * 0.73, 0.14, z);
    }
  }
  const flares: Record<number, THREE.BufferGeometry> = {
    1: flareGeometry(1),
    [-1]: flareGeometry(-1),
  };
  for (const sx of [-1, 1]) {
    add(flares[sx], trimMat, sx * 0.78, 0.26, 1.32);
    add(flares[sx], trimMat, sx * 0.78, 0.26, -1.32);
  }
  add(new THREE.BoxGeometry(0.06, 0.06, 1.5), trimMat, -0.48, 1.32, -0.64);
  add(new THREE.BoxGeometry(0.06, 0.06, 1.5), trimMat, 0.48, 1.32, -0.64);
  add(new THREE.BoxGeometry(0.06, 0.76, 0.06), trimMat, -0.62, 0.96, 0.28);
  add(new THREE.BoxGeometry(0.06, 0.76, 0.06), trimMat, 0.62, 0.96, 0.28);
  add(new THREE.BoxGeometry(0.06, 0.72, 0.06), trimMat, -0.58, 0.96, -1.36);
  add(new THREE.BoxGeometry(0.06, 0.72, 0.06), trimMat, 0.58, 0.96, -1.36);
  add(new THREE.BoxGeometry(1.26, 0.06, 0.06), trimMat, 0, 1.35, 0.28);
  add(new THREE.BoxGeometry(1.18, 0.06, 0.06), trimMat, 0, 1.32, -1.36);
  addPart(new THREE.BoxGeometry(0.06, 0.06, 1.78), trimMat, -0.6, 1.34, -0.55, -0.08);
  addPart(new THREE.BoxGeometry(0.06, 0.06, 1.78), trimMat, 0.6, 1.34, -0.55, 0.08);
  add(new THREE.BoxGeometry(0.16, 0.12, 0.04), trimMat, -0.82, 0.84, 0.44);
  add(new THREE.BoxGeometry(0.16, 0.12, 0.04), trimMat, 0.82, 0.84, 0.44);

  const headlight = new THREE.MeshBasicMaterial({ color: COLORS.headlight });
  const taillight = new THREE.MeshBasicMaterial({
    color: COLORS.taillight,
    transparent: true,
    opacity: 0.72,
  });
  add(new THREE.BoxGeometry(0.22, 0.14, 0.06), headlight, -0.42, 0.49, 1.93);
  add(new THREE.BoxGeometry(0.22, 0.14, 0.06), headlight, 0.42, 0.49, 1.93);
  const leftBrake = add(
    new THREE.BoxGeometry(0.16, 0.12, 0.05),
    taillight.clone(),
    -0.6,
    0.52,
    -1.97,
  );
  const rightBrake = add(
    new THREE.BoxGeometry(0.16, 0.12, 0.05),
    taillight.clone(),
    0.6,
    0.52,
    -1.97,
  );
  leftBrake.name = 'brakeLight';
  rightBrake.name = 'brakeLight';

  const spareGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.21, 9);
  spareGeo.rotateX(Math.PI / 2);
  add(
    spareGeo,
    new THREE.MeshLambertMaterial({ color: COLORS.wheel, flatShading: true }),
    0,
    0.62,
    -2.02,
  );

  addVariantDetails(group, variant, trimMat, accentMat);

  return group;
}

function addVariantDetails(
  group: THREE.Group,
  variant: number,
  trimMat: THREE.Material,
  accentMat: THREE.Material,
): void {
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };

  if (variant % 3 === 1) {
    add(new THREE.BoxGeometry(0.9, 0.1, 0.18), accentMat, 0, 1.42, 0.18);
    add(new THREE.BoxGeometry(0.18, 0.12, 0.12), trimMat, -0.38, 1.4, 0.32);
    add(new THREE.BoxGeometry(0.18, 0.12, 0.12), trimMat, 0.38, 1.4, 0.32);
  } else if (variant % 3 === 2) {
    add(new THREE.BoxGeometry(0.7, 0.18, 0.55), accentMat, 0, 1.44, -0.52);
    add(new THREE.BoxGeometry(0.78, 0.06, 0.64), trimMat, 0, 1.56, -0.52);
  } else if (variant % 3 === 0 && variant > 0) {
    const snorkel = add(new THREE.BoxGeometry(0.09, 0.68, 0.09), trimMat, 0.78, 0.96, 0.76);
    snorkel.rotation.z = -0.06;
    add(new THREE.BoxGeometry(0.22, 0.08, 0.1), accentMat, 0.78, 1.31, 0.67);
  }
}

/**
 * Wheel-arch flare: a low, slim lip that hugs the body. The top inner edge
 * tucks back toward the body so the flare doesn't visibly jut outward.
 */
function flareGeometry(side: 1 | -1): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(0.16, 0.1, 1.05).toNonIndexed();
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    // Top edge pulls inward (toward the body centerline); bottom stays put.
    if (pos.getY(i) > 0) pos.setX(i, pos.getX(i) - 0.05 * side);
  }
  geo.computeVertexNormals();
  return geo;
}
