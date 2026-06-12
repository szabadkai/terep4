/**
 * Chunked terrain renderer. Builds flat-shaded low-poly meshes around the
 * focus point (the vehicle) and disposes far ones — the streaming seam that
 * lets the map scale arbitrarily. Reads the Terrain sampler only; the sim
 * never depends on which chunks happen to be loaded.
 */

import * as THREE from 'three';
import { CHUNKS, COLORS, WORLD, type SurfaceId } from '../config';
import type { Terrain } from '../terrain/terrain';
import { hash2 } from '../terrain/noise';

export class TerrainView {
  private readonly chunks = new Map<string, THREE.Mesh>();
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true });
  private readonly water: THREE.Mesh;
  private readonly surfaceColors: Record<SurfaceId, THREE.Color>;
  private initialBuildDone = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly terrain: Terrain,
  ) {
    this.surfaceColors = Object.fromEntries(
      Object.entries(COLORS.surfaces).map(([k, hex]) => [k, new THREE.Color(hex)]),
    ) as Record<SurfaceId, THREE.Color>;

    const waterSize = (CHUNKS.viewRadius * 2 + 2) * CHUNKS.size * 2;
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(waterSize, waterSize),
      new THREE.MeshLambertMaterial({
        color: COLORS.water,
        transparent: true,
        opacity: COLORS.waterOpacity,
      }),
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = WORLD.waterLevel;
    scene.add(this.water);
  }

  update(focusX: number, focusZ: number): void {
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
        mesh.geometry.dispose();
        this.chunks.delete(key);
      }
    }

    this.water.position.x = focusX;
    this.water.position.z = focusZ;
  }

  private buildChunk(cx: number, cz: number): THREE.Mesh {
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
    return new THREE.Mesh(geometry, this.material);
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
    const mz = (p0[2] + p1[2] + p2[2]) / 3;
    const color = this.surfaceColors[this.terrain.surface(mx, mz)];
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
}
