/**
 * Renders the deterministic scatter (trees, rocks, reeds, logs, bushes, etc.) as one
 * InstancedMesh per kind per chunk, streamed with the same lifecycle as the
 * terrain chunks. Templates are merged low-poly primitives with baked
 * vertex colors; per-instance tint breaks up the repetition.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHUNKS, COLORS, WORLD } from '../config';
import { SCATTER_KINDS, itemsInRect, type ScatterItem, type ScatterKind } from '../terrain/scatter';
import { hash2 } from '../terrain/noise';
import type { Terrain } from '../terrain/terrain';

const tmpMatrix = new THREE.Matrix4();
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpColor = new THREE.Color();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export class ScatterView {
  private readonly chunks = new Map<string, THREE.Group>();
  private readonly templates: Record<ScatterKind, THREE.BufferGeometry>;
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true });

  constructor(
    private readonly scene: THREE.Scene,
    private readonly terrain: Terrain,
  ) {
    this.templates = {
      pine: pineTemplate(),
      tree: treeTemplate(),
      boulder: boulderTemplate(),
      bush: bushTemplate(),
      smallRock: smallRockTemplate(),
      log: logTemplate(),
      reed: reedTemplate(),
      deadTree: deadTreeTemplate(),
      grassClump: grassClumpTemplate(),
      markerPost: markerPostTemplate(),
    };
  }

  update(focusX: number, focusZ: number): void {
    const size = CHUNKS.size;
    const ccx = Math.floor(focusX / size);
    const ccz = Math.floor(focusZ / size);
    const r = CHUNKS.viewRadius;

    for (let cx = ccx - r; cx <= ccx + r; cx++) {
      for (let cz = ccz - r; cz <= ccz + r; cz++) {
        const key = `${cx},${cz}`;
        if (!this.chunks.has(key)) {
          const group = this.buildChunk(cx, cz);
          this.chunks.set(key, group);
          this.scene.add(group);
        }
      }
    }

    for (const [key, group] of this.chunks) {
      const [cx, cz] = key.split(',').map(Number);
      if (Math.max(Math.abs(cx - ccx), Math.abs(cz - ccz)) > r + 1) {
        this.scene.remove(group);
        for (const child of group.children) (child as THREE.InstancedMesh).dispose();
        this.chunks.delete(key);
      }
    }
  }

  private buildChunk(cx: number, cz: number): THREE.Group {
    const size = CHUNKS.size;
    const items = itemsInRect(
      cx * size,
      cz * size,
      (cx + 1) * size,
      (cz + 1) * size,
      this.terrain,
      WORLD.seed,
    );
    const group = new THREE.Group();

    for (const kind of SCATTER_KINDS) {
      const ofKind = items.filter((i) => i.kind === kind);
      if (ofKind.length === 0) continue;
      group.add(this.buildInstances(kind, ofKind));
    }
    return group;
  }

  private buildInstances(kind: ScatterKind, items: ScatterItem[]): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.templates[kind], this.material, items.length);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      tmpPos.set(item.x, item.y, item.z);
      tmpQuat.setFromAxisAngle(Y_AXIS, item.rotation);
      tmpScale.setScalar(item.size);
      mesh.setMatrixAt(i, tmpMatrix.compose(tmpPos, tmpQuat, tmpScale));
      const tint = 0.85 + 0.3 * hash2(Math.round(item.x * 3), Math.round(item.z * 3), 97);
      mesh.setColorAt(i, this.instanceTint(item, tint));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    return mesh;
  }

  private instanceTint(item: ScatterItem, tint: number): THREE.Color {
    const biome = this.terrain.biome(item.x, item.z);
    if ((item.kind === 'boulder' || item.kind === 'smallRock') && biome === 'snowRidge') {
      return tmpColor.setRGB(0.9 * tint, 0.96 * tint, 1.12 * tint);
    }
    if ((item.kind === 'boulder' || item.kind === 'smallRock') && biome === 'rockyHighlands') {
      return tmpColor.setRGB(1.08 * tint, 0.94 * tint, 0.82 * tint);
    }
    if ((item.kind === 'reed' || item.kind === 'bush') && biome === 'marsh') {
      return tmpColor.setRGB(0.72 * tint, 0.98 * tint, 0.72 * tint);
    }
    if (item.kind === 'log' && biome === 'sandyShore') {
      return tmpColor.setRGB(1.12 * tint, 1.02 * tint, 0.82 * tint);
    }
    if ((item.kind === 'pine' || item.kind === 'deadTree') && biome === 'pineForest') {
      return tmpColor.setRGB(0.78 * tint, 0.92 * tint, 0.74 * tint);
    }
    if (item.kind === 'grassClump' && biome === 'grassland') {
      return tmpColor.setRGB(1.05 * tint, 1.08 * tint, 0.8 * tint);
    }
    return tmpColor.setScalar(tint);
  }
}

/** Non-indexed (flat-shaded) geometry with a baked uniform vertex color. */
function paint(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const flat = geo.index ? geo.toNonIndexed() : geo;
  if (flat !== geo) geo.dispose();
  flat.computeVertexNormals();
  const c = new THREE.Color(hex);
  const count = flat.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return flat;
}

function pineTemplate(): THREE.BufferGeometry {
  return mergeGeometries([
    paint(new THREE.CylinderGeometry(0.09, 0.13, 1.0, 5).translate(0, 0.5, 0), COLORS.trunk),
    paint(new THREE.ConeGeometry(0.95, 1.7, 7).translate(0, 1.7, 0), COLORS.pine),
    paint(new THREE.ConeGeometry(0.66, 1.4, 7).translate(0, 2.7, 0), COLORS.pine),
    paint(new THREE.ConeGeometry(0.4, 1.1, 7).translate(0, 3.55, 0), COLORS.pine),
  ]);
}

function treeTemplate(): THREE.BufferGeometry {
  return mergeGeometries([
    paint(new THREE.CylinderGeometry(0.12, 0.17, 1.3, 5).translate(0, 0.65, 0), COLORS.trunk),
    paint(
      new THREE.IcosahedronGeometry(1.15, 0).scale(1, 0.85, 1).translate(0, 2.0, 0),
      COLORS.leaf,
    ),
    paint(
      new THREE.IcosahedronGeometry(0.7, 0).scale(1, 0.8, 1).translate(0.55, 2.55, 0.2),
      COLORS.leaf,
    ),
  ]);
}

function boulderTemplate(): THREE.BufferGeometry {
  return paint(
    new THREE.IcosahedronGeometry(1, 0).scale(1, 0.72, 1.15).translate(0, 0.45, 0),
    COLORS.boulder,
  );
}

function smallRockTemplate(): THREE.BufferGeometry {
  return paint(
    new THREE.DodecahedronGeometry(0.55, 0).scale(1.1, 0.55, 0.85).translate(0, 0.22, 0),
    COLORS.boulder,
  );
}

function bushTemplate(): THREE.BufferGeometry {
  return mergeGeometries([
    paint(
      new THREE.IcosahedronGeometry(0.7, 0).scale(1.25, 0.62, 1).translate(0, 0.42, 0),
      COLORS.bush,
    ),
    paint(
      new THREE.IcosahedronGeometry(0.45, 0).scale(0.9, 0.55, 1).translate(0.45, 0.62, 0.08),
      COLORS.leaf,
    ),
  ]);
}

function logTemplate(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.22, 0.26, 1.8, 7);
  trunk.rotateZ(Math.PI / 2);
  trunk.translate(0, 0.26, 0);
  const endA = new THREE.CylinderGeometry(0.235, 0.235, 0.035, 7);
  endA.rotateZ(Math.PI / 2);
  endA.translate(-0.92, 0.26, 0);
  const endB = endA.clone().translate(1.84, 0, 0);
  return mergeGeometries([
    paint(trunk, COLORS.deadWood),
    paint(endA, COLORS.trunk),
    paint(endB, COLORS.trunk),
  ]);
}

function reedTemplate(): THREE.BufferGeometry {
  return mergeGeometries([
    reedBlade(-0.16, 0.62, -0.18),
    reedBlade(0.04, 0.82, 0.08),
    reedBlade(0.18, 0.55, 0.28),
    paint(
      new THREE.CylinderGeometry(0.035, 0.035, 0.28, 5).translate(0.04, 0.78, 0.08),
      COLORS.trunk,
    ),
  ]);
}

function reedBlade(x: number, height: number, rot: number): THREE.BufferGeometry {
  const blade = new THREE.ConeGeometry(0.055, height, 4);
  blade.rotateZ(rot);
  blade.translate(x, height / 2, 0);
  return paint(blade, COLORS.reed);
}

function deadTreeTemplate(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.11, 0.17, 2.6, 5).translate(0, 1.3, 0);
  const branchA = new THREE.CylinderGeometry(0.035, 0.055, 0.85, 5);
  branchA.rotateZ(-0.85);
  branchA.translate(0.3, 1.75, 0);
  const branchB = new THREE.CylinderGeometry(0.03, 0.05, 0.7, 5);
  branchB.rotateZ(0.75);
  branchB.rotateY(0.8);
  branchB.translate(-0.24, 1.35, 0.12);
  return mergeGeometries([
    paint(trunk, COLORS.deadWood),
    paint(branchA, COLORS.deadWood),
    paint(branchB, COLORS.deadWood),
  ]);
}

function grassClumpTemplate(): THREE.BufferGeometry {
  return mergeGeometries([
    grassBlade(-0.22, 0.55, -0.36),
    grassBlade(-0.08, 0.68, -0.16),
    grassBlade(0.08, 0.62, 0.18),
    grassBlade(0.22, 0.48, 0.38),
  ]);
}

function grassBlade(x: number, height: number, rot: number): THREE.BufferGeometry {
  const blade = new THREE.ConeGeometry(0.04, height, 4);
  blade.rotateZ(rot);
  blade.translate(x, height / 2, 0);
  return paint(blade, COLORS.grassClump);
}

function markerPostTemplate(): THREE.BufferGeometry {
  return mergeGeometries([
    paint(new THREE.CylinderGeometry(0.07, 0.08, 1.25, 5).translate(0, 0.62, 0), COLORS.deadWood),
    paint(new THREE.BoxGeometry(0.18, 0.42, 0.08).translate(0, 1.18, 0), COLORS.markerPaint),
    paint(new THREE.BoxGeometry(0.2, 0.06, 0.1).translate(0, 1.05, 0), COLORS.trim),
  ]);
}
