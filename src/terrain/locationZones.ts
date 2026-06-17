import { RACE, WORLD, type BiomeId } from '../config';
import { hash2 } from './noise';

export interface LocationZone {
  id: number;
  name: string;
  center: { x: number; z: number };
  radius: number;
  biome: BiomeId;
  landmarkStyle: 'ridge' | 'woods' | 'wetland' | 'flats' | 'pass' | 'shore';
  scatterStyle: 'open' | 'densePine' | 'wet' | 'rocky' | 'sparseSnow' | 'shoreline';
}

const ZONE_TEMPLATES: Array<
  Pick<LocationZone, 'name' | 'biome' | 'landmarkStyle' | 'scatterStyle'>
> = [
  { name: 'North Ridge', biome: 'rockyHighlands', landmarkStyle: 'ridge', scatterStyle: 'rocky' },
  {
    name: 'Blackpine Woods',
    biome: 'pineForest',
    landmarkStyle: 'woods',
    scatterStyle: 'densePine',
  },
  { name: 'Low Marsh', biome: 'marsh', landmarkStyle: 'wetland', scatterStyle: 'wet' },
  { name: 'Redstone Flats', biome: 'grassland', landmarkStyle: 'flats', scatterStyle: 'open' },
  { name: 'Snowcap Pass', biome: 'snowRidge', landmarkStyle: 'pass', scatterStyle: 'sparseSnow' },
  { name: 'South Shore', biome: 'sandyShore', landmarkStyle: 'shore', scatterStyle: 'shoreline' },
];

const ZONE_DISTANCE = RACE.ringRadius * 1.04;
const ZONE_RADIUS_MIN = 118;
const ZONE_RADIUS_MAX = 170;
const TWO_PI = Math.PI * 2;

export function createLocationZones(seed: number): readonly LocationZone[] {
  return ZONE_TEMPLATES.map((template, id) => {
    const baseAngle = (TWO_PI / ZONE_TEMPLATES.length) * id;
    const angle = baseAngle + (hash2(id, 31, seed) - 0.5) * 0.5;
    const distance = ZONE_DISTANCE + (hash2(id, 32, seed) - 0.5) * 70;
    return {
      ...template,
      id,
      center: {
        x: Math.sin(angle) * distance,
        z: Math.cos(angle) * distance,
      },
      radius: ZONE_RADIUS_MIN + hash2(id, 33, seed) * (ZONE_RADIUS_MAX - ZONE_RADIUS_MIN),
    };
  });
}

export function locationZoneAt(
  x: number,
  z: number,
  zones: readonly LocationZone[],
): LocationZone | null {
  let best: LocationZone | null = null;
  let bestScore = 0;
  for (const zone of zones) {
    const d = Math.hypot(x - zone.center.x, z - zone.center.z);
    if (d > zone.radius) continue;
    const score = 1 - d / zone.radius;
    if (score > bestScore) {
      best = zone;
      bestScore = score;
    }
  }
  if (Math.hypot(x, z) < WORLD.gen.spawnFlatOuter * 0.95) return null;
  return best;
}
