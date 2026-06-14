/**
 * Deterministic scatter: trees and boulders placed by hashing a world-space
 * cell grid. Pure functions of position + seed, so the sim (trunk collision)
 * and the renderer (instanced meshes per chunk) always agree without any
 * shared state — the same trick the heightfield uses.
 */

import { Vec3, smoothstep } from '../core/math';
import { SCATTER, WORLD } from '../config';
import { hash2, fbm } from './noise';
import type { Terrain } from './terrain';

export type ScatterKind = 'pine' | 'tree' | 'boulder';

export interface ScatterItem {
  kind: ScatterKind;
  x: number;
  z: number;
  /** Terrain height at the base (boulders sink slightly below). */
  y: number;
  size: number;
  rotation: number;
  /** Collision radius of the trunk/body (m). */
  radius: number;
  /** Collision height above the base (m). */
  height: number;
}

const tmpNormal = new Vec3();

/** At most one item per cell; null when the cell is empty. */
export function itemInCell(
  cx: number,
  cz: number,
  terrain: Terrain,
  seed: number,
): ScatterItem | null {
  const roll = hash2(cx, cz, seed + 501);
  const x = (cx + 0.2 + 0.6 * hash2(cx, cz, seed + 502)) * SCATTER.cell;
  const z = (cz + 0.2 + 0.6 * hash2(cx, cz, seed + 503)) * SCATTER.cell;
  if (x * x + z * z < SCATTER.clearRadius * SCATTER.clearRadius) return null;

  const h = terrain.height(x, z);
  if (h < WORLD.waterLevel + WORLD.sandShore) return null;
  const biome = terrain.biome(x, z);

  const size = 0.8 + 0.5 * hash2(cx, cz, seed + 505);
  const rotation = hash2(cx, cz, seed + 506) * Math.PI * 2;

  const boulderChance =
    SCATTER.boulderChance *
    (biome === 'rockyHighlands' ? 5.5 : biome === 'snowRidge' ? 2.2 : biome === 'marsh' ? 0.35 : 1);
  const boulder = roll > 1 - boulderChance;
  if (boulder) {
    return {
      kind: 'boulder',
      x,
      z,
      y: h - 0.2 * size,
      size,
      rotation,
      radius: SCATTER.boulderRadius * size,
      height: 1.2 * size,
    };
  }

  const forest = fbm(x / SCATTER.forestWavelength, z / SCATTER.forestWavelength, 2, seed + 504);
  const densityMul =
    biome === 'pineForest'
      ? 1.55
      : biome === 'marsh'
        ? 0.42
        : biome === 'rockyHighlands'
          ? 0.28
          : biome === 'snowRidge'
            ? 0.38
            : biome === 'sandyShore'
              ? 0.18
              : biome === 'riverValley'
                ? 0.72
                : 0.9;
  const density = (SCATTER.treeBase + SCATTER.treeForest * smoothstep(0.05, 0.55, forest)) * densityMul;
  if (roll >= density) return null;
  if (h > SCATTER.treeline) return null;
  if (terrain.normal(x, z, tmpNormal).y < SCATTER.maxSlope) return null;

  const pineChance =
    biome === 'pineForest'
      ? 0.88
      : biome === 'snowRidge'
        ? 0.78
        : biome === 'rockyHighlands'
          ? 0.65
          : biome === 'marsh' || biome === 'sandyShore'
            ? 0.18
            : h > 14
              ? 0.7
              : 0.45;
  const kind: ScatterKind = hash2(cx, cz, seed + 507) < pineChance ? 'pine' : 'tree';
  return {
    kind,
    x,
    z,
    y: h,
    size,
    rotation,
    radius: SCATTER.trunkRadius * size,
    height: 4.2 * size,
  };
}

/** Visit every item whose cell could place it within `range` of (x, z). */
export function forEachItemNear(
  x: number,
  z: number,
  range: number,
  terrain: Terrain,
  seed: number,
  visit: (item: ScatterItem) => void,
): void {
  const c = SCATTER.cell;
  const x0 = Math.floor((x - range) / c);
  const x1 = Math.floor((x + range) / c);
  const z0 = Math.floor((z - range) / c);
  const z1 = Math.floor((z + range) / c);
  for (let cx = x0; cx <= x1; cx++) {
    for (let cz = z0; cz <= z1; cz++) {
      const item = itemInCell(cx, cz, terrain, seed);
      if (item) visit(item);
    }
  }
}

/** Items whose position falls inside the given world-space rectangle. */
export function itemsInRect(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  terrain: Terrain,
  seed: number,
): ScatterItem[] {
  const c = SCATTER.cell;
  const items: ScatterItem[] = [];
  for (let cx = Math.floor(minX / c); cx <= Math.floor(maxX / c); cx++) {
    for (let cz = Math.floor(minZ / c); cz <= Math.floor(maxZ / c); cz++) {
      const item = itemInCell(cx, cz, terrain, seed);
      if (item && item.x >= minX && item.x < maxX && item.z >= minZ && item.z < maxZ) {
        items.push(item);
      }
    }
  }
  return items;
}
