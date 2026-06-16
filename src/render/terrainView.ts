/**
 * Chunked terrain renderer. Builds flat-shaded low-poly meshes around the
 * focus point (the vehicle) and disposes far ones — the streaming seam that
 * lets the map scale arbitrarily. Reads the Terrain sampler only; the sim
 * never depends on which chunks happen to be loaded.
 */

import * as THREE from 'three';
import { CHUNKS, COLORS, WORLD, type BiomeId, type SurfaceId } from '../config';
import type { Terrain } from '../terrain/terrain';
import { hash2, fbm } from '../terrain/noise';
import { smoothstep } from '../core/math';

const SHORE_SCAN_STEP = 4;
const MAX_SHORE_MARKS_PER_CHUNK = 46;
const MAX_REEDS_PER_CHUNK = 34;
const MAX_STONES_PER_CHUNK = 18;
const WATER_LIFT = 0.035;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export class TerrainView {
  private readonly chunks = new Map<string, THREE.Group>();
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true });
  private readonly waterMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      time: { value: 0 },
      colorDeep: { value: new THREE.Color(COLORS.water) },
      colorShallow: { value: new THREE.Color(COLORS.waterShallow) },
      opacity: { value: COLORS.waterOpacity },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec2 vWave;
      uniform float time;
      void main() {
        vec3 p = position;
        float waveA = sin((p.x + time * 5.5) * 0.035 + p.y * 0.012);
        float waveB = sin((p.y - time * 3.5) * 0.045 + p.x * 0.018);
        p.z += (waveA + waveB) * 0.035;
        vec4 world = modelMatrix * vec4(p, 1.0);
        vWorld = world.xyz;
        vWave = vec2(waveA, waveB);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec2 vWave;
      uniform vec3 colorDeep;
      uniform vec3 colorShallow;
      uniform float opacity;
      void main() {
        float ripple = 0.5 + 0.5 * sin(vWorld.x * 0.065 + vWorld.z * 0.04 + vWave.x * 0.8);
        vec3 color = mix(colorDeep, colorShallow, 0.34 + ripple * 0.22);
        gl_FragColor = vec4(color, opacity * (0.78 + ripple * 0.2));
      }
    `,
  });
  private readonly water: THREE.Mesh;
  private readonly foamMat = new THREE.MeshBasicMaterial({
    color: COLORS.foam,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private readonly reedGeo = new THREE.CylinderGeometry(0.025, 0.045, 1.15, 5);
  private readonly reedMat = new THREE.MeshLambertMaterial({
    color: COLORS.reed,
    flatShading: true,
  });
  private readonly stoneGeo = new THREE.DodecahedronGeometry(0.34, 0);
  private readonly stoneMat = new THREE.MeshLambertMaterial({
    color: COLORS.shoreStone,
    flatShading: true,
  });
  private readonly surfaceColors: Record<SurfaceId, THREE.Color>;
  private readonly biomeColors: Record<BiomeId, THREE.Color>;
  private readonly grassDry = new THREE.Color(COLORS.grassDry);
  private readonly rockSteep = new THREE.Color(COLORS.rockSteep);
  private readonly faceTint = new THREE.Color();
  private readonly tmpMat = new THREE.Matrix4();
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpScale = new THREE.Vector3();
  private initialBuildDone = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly terrain: Terrain,
  ) {
    this.surfaceColors = Object.fromEntries(
      Object.entries(COLORS.surfaces).map(([k, hex]) => [k, new THREE.Color(hex)]),
    ) as Record<SurfaceId, THREE.Color>;
    this.biomeColors = Object.fromEntries(
      Object.entries(COLORS.biomeTint).map(([k, hex]) => [k, new THREE.Color(hex)]),
    ) as Record<BiomeId, THREE.Color>;

    const waterSize = (CHUNKS.viewRadius * 2 + 2) * CHUNKS.size * 2;
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(waterSize, waterSize), this.waterMaterial);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = WORLD.waterLevel;
    scene.add(this.water);
  }

  update(focusX: number, focusZ: number, timeSec = 0): void {
    this.waterMaterial.uniforms.time.value = timeSec;
    const size = CHUNKS.size;
    const ccx = Math.floor(focusX / size);
    const ccz = Math.floor(focusZ / size);
    const r = CHUNKS.viewRadius;

    // Collect missing chunks, nearest first.
    const missing: Array<{ cx: number; cz: number; d: number }> = [];
    for (let cx = ccx - r; cx <= ccx + r; cx++) {
      for (let cz = ccz - r; cz <= ccz + r; cz++) {
        if (!this.chunks.has(`${cx},${cz}`)) {
          missing.push({ cx, cz, d: Math.hypot(cx - ccx, cz - ccz) });
        }
      }
    }
    missing.sort((a, b) => a.d - b.d);

    const budget = this.initialBuildDone ? CHUNKS.buildsPerFrame : missing.length;
    for (let i = 0; i < Math.min(budget, missing.length); i++) {
      const { cx, cz } = missing[i];
      const mesh = this.buildChunk(cx, cz);
      this.chunks.set(`${cx},${cz}`, mesh);
      this.scene.add(mesh);
    }
    this.initialBuildDone = true;

    // Drop chunks well outside the view radius (hysteresis of one chunk).
    for (const [key, mesh] of this.chunks) {
      const [cx, cz] = key.split(',').map(Number);
      if (Math.max(Math.abs(cx - ccx), Math.abs(cz - ccz)) > r + 1) {
        this.scene.remove(mesh);
        this.disposeChunk(mesh);
        this.chunks.delete(key);
      }
    }

    this.water.position.x = focusX;
    this.water.position.z = focusZ;
  }

  private buildChunk(cx: number, cz: number): THREE.Group {
    const cells = CHUNKS.cells;
    const cell = CHUNKS.size / cells;
    const x0 = cx * CHUNKS.size;
    const z0 = cz * CHUNKS.size;

    // Sample the height grid once; triangles share these values, so chunk
    // borders match exactly (same continuous function everywhere).
    const grid = new Float32Array((cells + 1) * (cells + 1));
    for (let j = 0; j <= cells; j++) {
      for (let i = 0; i <= cells; i++) {
        grid[j * (cells + 1) + i] = this.terrain.height(x0 + i * cell, z0 + j * cell);
      }
    }

    const triCount = cells * cells * 2;
    const positions = new Float32Array(triCount * 9);
    const normals = new Float32Array(triCount * 9);
    const colors = new Float32Array(triCount * 9);
    let v = 0;

    const corner = (i: number, j: number): [number, number, number] => [
      x0 + i * cell,
      grid[j * (cells + 1) + i],
      z0 + j * cell,
    ];

    for (let j = 0; j < cells; j++) {
      for (let i = 0; i < cells; i++) {
        const a = corner(i, j);
        const b = corner(i + 1, j);
        const c = corner(i, j + 1);
        const d = corner(i + 1, j + 1);
        // Alternate the quad diagonal for a less regular low-poly look.
        const tris: Array<[number[], number[], number[]]> =
          (i + j) % 2 === 0
            ? [
                [a, c, b],
                [b, c, d],
              ]
            : [
                [a, c, d],
                [a, d, b],
              ];
        for (const [p0, p1, p2] of tris) {
          v = this.emitTriangle(positions, normals, colors, v, p0, p1, p2);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geometry, this.material));

    const shore = this.buildShorelineDetails(x0, z0);
    if (shore) group.add(shore);
    return group;
  }

  private buildShorelineDetails(x0: number, z0: number): THREE.Group | null {
    const group = new THREE.Group();
    const foamPositions: number[] = [];
    const reedSamples: Array<{ x: number; y: number; z: number; scale: number; yaw: number }> = [];
    const stoneSamples: Array<{ x: number; y: number; z: number; scale: number; yaw: number }> = [];
    const size = CHUNKS.size;
    let foamCount = 0;

    for (let z = z0 + SHORE_SCAN_STEP * 0.5; z < z0 + size; z += SHORE_SCAN_STEP) {
      for (let x = x0 + SHORE_SCAN_STEP * 0.5; x < x0 + size; x += SHORE_SCAN_STEP) {
        const h = this.terrain.height(x, z);
        const shore = this.shoreAmount(x, z, h);
        if (shore <= 0) continue;

        const hash = hash2(Math.round(x * 2), Math.round(z * 2), 613);
        if (foamCount < MAX_SHORE_MARKS_PER_CHUNK && hash > 0.28) {
          const angle = hash2(Math.round(x * 2), Math.round(z * 2), 614) * Math.PI * 2;
          this.addFoamQuad(foamPositions, x, z, angle, 1.8 + shore * 2.2, 0.16 + shore * 0.18);
          foamCount++;
        }
        if (
          reedSamples.length < MAX_REEDS_PER_CHUNK &&
          h > WORLD.waterLevel - 0.05 &&
          hash < 0.23
        ) {
          reedSamples.push({
            x,
            y: Math.max(h, WORLD.waterLevel) + 0.42,
            z,
            scale: 0.72 + hash2(Math.round(x), Math.round(z), 615) * 0.7,
            yaw: hash2(Math.round(x), Math.round(z), 616) * Math.PI * 2,
          });
        }
        if (stoneSamples.length < MAX_STONES_PER_CHUNK && h > WORLD.waterLevel && hash > 0.86) {
          stoneSamples.push({
            x,
            y: h + 0.12,
            z,
            scale: 0.45 + hash2(Math.round(x), Math.round(z), 617) * 0.75,
            yaw: hash2(Math.round(x), Math.round(z), 618) * Math.PI * 2,
          });
        }
      }
    }

    if (foamPositions.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(foamPositions, 3));
      geometry.computeVertexNormals();
      group.add(new THREE.Mesh(geometry, this.foamMat));
    }
    if (reedSamples.length > 0)
      group.add(this.buildInstances(this.reedGeo, this.reedMat, reedSamples, true));
    if (stoneSamples.length > 0) {
      group.add(this.buildInstances(this.stoneGeo, this.stoneMat, stoneSamples, false));
    }
    return group.children.length > 0 ? group : null;
  }

  private shoreAmount(x: number, z: number, h: number): number {
    const nearSurface = 1 - smoothstep(WORLD.waterLevel - 0.4, WORLD.waterLevel + 2.4, h);
    if (nearSurface <= 0) return 0;
    const step = SHORE_SCAN_STEP * 0.9;
    let hasWater = h < WORLD.waterLevel;
    for (const [ox, oz] of [
      [step, 0],
      [-step, 0],
      [0, step],
      [0, -step],
    ]) {
      if (this.terrain.height(x + ox, z + oz) < WORLD.waterLevel + 0.18) {
        hasWater = true;
        break;
      }
    }
    return hasWater ? nearSurface : 0;
  }

  private addFoamQuad(
    positions: number[],
    x: number,
    z: number,
    angle: number,
    length: number,
    width: number,
  ): void {
    const cx = Math.cos(angle);
    const sz = Math.sin(angle);
    const px = -sz;
    const pz = cx;
    const y = WORLD.waterLevel + WATER_LIFT;
    const l = length * 0.5;
    const w = width * 0.5;
    const a = [x - cx * l - px * w, y, z - sz * l - pz * w];
    const b = [x + cx * l - px * w, y, z + sz * l - pz * w];
    const c = [x - cx * l + px * w, y, z - sz * l + pz * w];
    const d = [x + cx * l + px * w, y, z + sz * l + pz * w];
    positions.push(...a, ...c, ...b, ...b, ...c, ...d);
  }

  private buildInstances(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    samples: Array<{ x: number; y: number; z: number; scale: number; yaw: number }>,
    reed: boolean,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, samples.length);
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      this.tmpPos.set(s.x, s.y, s.z);
      this.tmpQuat.setFromAxisAngle(Y_AXIS, s.yaw);
      if (reed) this.tmpScale.set(0.75, s.scale, 0.75);
      else this.tmpScale.set(s.scale * 1.4, s.scale * 0.55, s.scale);
      mesh.setMatrixAt(i, this.tmpMat.compose(this.tmpPos, this.tmpQuat, this.tmpScale));
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    return mesh;
  }

  private disposeChunk(group: THREE.Group): void {
    group.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh || obj instanceof THREE.InstancedMesh)) return;
      if (obj.geometry !== this.reedGeo && obj.geometry !== this.stoneGeo) obj.geometry.dispose();
    });
  }

  private emitTriangle(
    positions: Float32Array,
    normals: Float32Array,
    colors: Float32Array,
    v: number,
    p0: number[],
    p1: number[],
    p2: number[],
  ): number {
    // Flat face normal.
    const ux = p1[0] - p0[0];
    const uy = p1[1] - p0[1];
    const uz = p1[2] - p0[2];
    const wx = p2[0] - p0[0];
    const wy = p2[1] - p0[1];
    const wz = p2[2] - p0[2];
    let nx = uy * wz - uz * wy;
    let ny = uz * wx - ux * wz;
    let nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;

    const mx = (p0[0] + p1[0] + p2[0]) / 3;
    const my = (p0[1] + p1[1] + p2[1]) / 3;
    const mz = (p0[2] + p1[2] + p2[2]) / 3;
    const color = this.faceColor(
      this.terrain.surface(mx, mz),
      this.terrain.biome(mx, mz),
      mx,
      my,
      mz,
      ny,
    );
    // Deterministic per-face brightness jitter sells the faceted look.
    const jitter =
      1 -
      COLORS.faceJitter / 2 +
      hash2(Math.round(mx * 4), Math.round(mz * 4), 31) * COLORS.faceJitter;

    for (const p of [p0, p1, p2]) {
      positions[v] = p[0];
      positions[v + 1] = p[1];
      positions[v + 2] = p[2];
      normals[v] = nx;
      normals[v + 1] = ny;
      normals[v + 2] = nz;
      colors[v] = color.r * jitter;
      colors[v + 1] = color.g * jitter;
      colors[v + 2] = color.b * jitter;
      v += 3;
    }
    return v;
  }

  /** Surface color varied by moisture noise, altitude, slope and depth. */
  private faceColor(
    surface: SurfaceId,
    biome: BiomeId,
    mx: number,
    my: number,
    mz: number,
    ny: number,
  ): THREE.Color {
    const c = this.faceTint.copy(this.surfaceColors[surface]);
    if (surface === 'grass') {
      // Patches of dry, yellowed grass; slightly darker with altitude.
      const dry = 0.5 + 0.5 * fbm(mx / 75, mz / 75, 2, 71);
      c.lerp(this.grassDry, 0.6 * dry);
      c.multiplyScalar(1 - 0.18 * smoothstep(12, 24, my));
    } else if (surface === 'rock') {
      // Steeper faces read darker, like exposed strata.
      c.lerp(this.rockSteep, 0.7 * smoothstep(0.85, 0.5, ny));
    } else if (surface === 'water') {
      // Lake and river beds darken with depth.
      c.multiplyScalar(Math.max(0.45, 1 + (my - WORLD.waterLevel) * 0.12));
    } else if (surface === 'snow') {
      c.multiplyScalar(1 - 0.15 * smoothstep(0.9, 0.6, ny));
    }
    const tintAmount =
      surface === 'water'
        ? 0.16
        : surface === 'snow'
          ? 0.22
          : surface === 'rock'
            ? 0.3
            : surface === 'sand'
              ? 0.26
              : 0.38;
    c.lerp(this.biomeColors[biome], tintAmount);
    return c;
  }
}
