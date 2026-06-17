/**
 * Deterministic scatter: trees and boulders placed by hashing a world-space
 * cell grid. Pure functions of position + seed, so the sim (trunk collision)
 * and the renderer (instanced meshes per chunk) always agree without any
 * shared state — the same trick the heightfield uses.
 */

import { Vec3, smoothstep } from '../core/math';
import { SCATTER, WORLD, type BiomeId, type SurfaceId } from '../config';
import { hash2, fbm } from './noise';
import type { Terrain } from './terrain';

export const SCATTER_KINDS = [
  'pine',
  'tree',
  'boulder',
  'bush',
  'smallRock',
  'log',
  'reed',
  'deadTree',
  'grassClump',
  'markerPost',
] as const;

export type ScatterKind = (typeof SCATTER_KINDS)[number];

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

interface BiomeScatterRule {
  smallPropChance: number;
  treeDensityMul: number;
  pineChance: number;
  boulderMul: number;
}

const BIOME_RULES: Record<BiomeId, BiomeScatterRule> = {
  grassland: { smallPropChance: 0.2, treeDensityMul: 0.64, pineChance: 0.24, boulderMul: 0.65 },
  pineForest: { smallPropChance: 0.2, treeDensityMul: 1.68, pineChance: 0.92, boulderMul: 0.42 },
  marsh: { smallPropChance: 0.38, treeDensityMul: 0.22, pineChance: 0.1, boulderMul: 0.14 },
  rockyHighlands: {
    smallPropChance: 0.36,
    treeDensityMul: 0.16,
    pineChance: 0.64,
    boulderMul: 6.4,
  },
  snowRidge: { smallPropChance: 0.24, treeDensityMul: 0.26, pineChance: 0.74, boulderMul: 2.8 },
  sandyShore: { smallPropChance: 0.34, treeDensityMul: 0.1, pineChance: 0.12, boulderMul: 0.45 },
  riverValley: { smallPropChance: 0.28, treeDensityMul: 0.52, pineChance: 0.22, boulderMul: 0.55 },
};

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
  if (h < WORLD.waterLevel + 0.18) return null;
  const biome = terrain.biome(x, z);
  const surface = terrain.surface(x, z);
  const shore = h < WORLD.waterLevel + WORLD.sandShore + 1.7;
  const slopeY = terrain.normal(x, z, tmpNormal).y;

  const size = 0.8 + 0.5 * hash2(cx, cz, seed + 505);
  const rotation = hash2(cx, cz, seed + 506) * Math.PI * 2;
  const rule = BIOME_RULES[biome];

  const boulderChance = SCATTER.boulderChance * rule.boulderMul;
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

  const prop = smallProp(cx, cz, x, z, h, biome, surface, shore, slopeY, seed);
  if (prop) return prop;

  const forest = fbm(x / SCATTER.forestWavelength, z / SCATTER.forestWavelength, 2, seed + 504);
  const density =
    (SCATTER.treeBase + SCATTER.treeForest * smoothstep(0.05, 0.55, forest)) * rule.treeDensityMul;
  if (roll >= density) return null;
  if (h > SCATTER.treeline) return null;
  if (slopeY < SCATTER.maxSlope) return null;

  const pineChance = h > 14 ? Math.max(rule.pineChance, 0.68) : rule.pineChance;
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

function smallProp(
  cx: number,
  cz: number,
  x: number,
  z: number,
  h: number,
  biome: BiomeId,
  surface: SurfaceId,
  shore: boolean,
  slopeY: number,
  seed: number,
): ScatterItem | null {
  if (slopeY < 0.62) return null;

  const propRoll = hash2(cx, cz, seed + 520);
  const chance = BIOME_RULES[biome].smallPropChance;
  if (propRoll > chance) return null;

  const pick = hash2(cx, cz, seed + 521);
  const size = 0.65 + 0.8 * hash2(cx, cz, seed + 522);
  const rotation = hash2(cx, cz, seed + 523) * Math.PI * 2;

  if (biome === 'pineForest') {
    if (pick < 0.42) return propItem('log', x, z, h + 0.08, size * 1.1, rotation, 0.38 * size, 0.4);
    if (pick < 0.68) {
      return propItem(
        'deadTree',
        x,
        z,
        h,
        size * 0.9,
        rotation,
        SCATTER.trunkRadius * size,
        3.0 * size,
      );
    }
    if (pick < 0.86) return propItem('bush', x, z, h, size * 0.85, rotation, 0, 0.9);
    return propItem('grassClump', x, z, h, size * 0.72, rotation, 0, 0.48);
  }

  if (biome === 'marsh') {
    if (pick < 0.46) return propItem('reed', x, z, h, size, rotation, 0, 1.0);
    if (pick < 0.68) return propItem('bush', x, z, h, size * 0.72, rotation, 0, 0.8);
    if (pick < 0.9) return propItem('log', x, z, h + 0.06, size * 0.9, rotation, 0.28 * size, 0.32);
    return propItem('grassClump', x, z, h, size * 0.85, rotation, 0, 0.48);
  }

  if (biome === 'rockyHighlands') {
    if (pick < 0.72) return propItem('smallRock', x, z, h - 0.05 * size, size, rotation, 0, 0.42);
    if (pick < 0.9) return propItem('bush', x, z, h, size * 0.62, rotation, 0, 0.72);
    return propItem(
      'deadTree',
      x,
      z,
      h,
      size * 0.76,
      rotation,
      SCATTER.trunkRadius * size,
      2.5 * size,
    );
  }

  if (biome === 'snowRidge') {
    if (pick < 0.46)
      return propItem('smallRock', x, z, h - 0.05 * size, size * 0.9, rotation, 0, 0.36);
    if (pick < 0.8) {
      return propItem(
        'deadTree',
        x,
        z,
        h,
        size * 0.78,
        rotation,
        SCATTER.trunkRadius * size,
        2.7 * size,
      );
    }
    return propItem('grassClump', x, z, h, size * 0.52, rotation, 0, 0.36);
  }

  if (biome === 'sandyShore') {
    if (pick < 0.34) return propItem('reed', x, z, h, size * 0.78, rotation, 0, 0.82);
    if (pick < 0.72) return propItem('log', x, z, h + 0.08, size, rotation, 0.34 * size, 0.34);
    if (pick < 0.9)
      return propItem('smallRock', x, z, h - 0.05 * size, size * 0.68, rotation, 0, 0.3);
    return propItem('bush', x, z, h, size * 0.58, rotation, 0, 0.62);
  }

  if ((shore || biome === 'riverValley') && pick < 0.42) {
    return propItem('reed', x, z, h, size * 0.85, rotation, 0, 0.9);
  }
  if (surface === 'rock') {
    return pick < 0.62
      ? propItem('smallRock', x, z, h - 0.05 * size, size, rotation, 0, 0.42)
      : propItem('deadTree', x, z, h, size * 0.9, rotation, SCATTER.trunkRadius * size, 3.0 * size);
  }
  if (surface === 'sand') {
    return pick < 0.48
      ? propItem('log', x, z, h + 0.08, size, rotation, 0.42 * size, 0.42 * size)
      : propItem('smallRock', x, z, h - 0.05 * size, size * 0.75, rotation, 0, 0.32);
  }
  if (surface === 'snow') {
    return pick < 0.45
      ? propItem('smallRock', x, z, h - 0.05 * size, size * 0.85, rotation, 0, 0.36)
      : propItem(
          'deadTree',
          x,
          z,
          h,
          size * 0.82,
          rotation,
          SCATTER.trunkRadius * size,
          2.8 * size,
        );
  }
  if (pick < 0.36) return propItem('grassClump', x, z, h, size, rotation, 0, 0.55);
  if (pick < 0.66) return propItem('bush', x, z, h, size, rotation, 0, 0.95);
  if (pick < 0.86) return propItem('markerPost', x, z, h, size, rotation, 0.11 * size, 1.5 * size);
  return propItem('log', x, z, h + 0.08, size, rotation, 0.42 * size, 0.42 * size);
}

function propItem(
  kind: ScatterKind,
  x: number,
  z: number,
  y: number,
  size: number,
  rotation: number,
  radius: number,
  height: number,
): ScatterItem {
  return { kind, x, z, y, size, rotation, radius, height };
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
