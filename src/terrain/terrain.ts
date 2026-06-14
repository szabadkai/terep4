/**
 * Terrain: continuous height, normal and surface-type sampling over an
 * unbounded plane, plus a heightfield raycast for the wheel rays.
 *
 * Heights come from a HeightSource so the procedural generator can later be
 * swapped for image-driven heightmaps without touching consumers. Everything
 * is a pure function of position — chunking (render meshes) happens
 * elsewhere; the sim can sample anywhere, which is what makes the map
 * "drive anywhere" with no loaded/unloaded seams in physics.
 */

import { Vec3, smoothstep, lerp } from '../core/math';
import { WORLD, type BiomeId, type SurfaceId } from '../config';
import { fbm, ridgedFbm } from './noise';

export interface HeightSource {
  height(x: number, z: number): number;
}

export class NoiseHeightSource implements HeightSource {
  constructor(private readonly seed: number) {}

  height(x: number, z: number): number {
    const g = WORLD.gen;
    const r = Math.hypot(x, z);
    // Large relief fades in away from the spawn so the start area is drivable.
    const relief = smoothstep(g.reliefStart, g.reliefEnd, r);

    // Domain warp makes ridges and valleys bend instead of following the grid.
    const wx =
      x + g.warpStrength * fbm(x / g.warpWavelength, z / g.warpWavelength, 2, this.seed + 11);
    const wz =
      z +
      g.warpStrength *
        fbm(x / g.warpWavelength + 5.2, z / g.warpWavelength - 3.1, 2, this.seed + 12);

    const mountains =
      ridgedFbm(wx / g.mountainWavelength, wz / g.mountainWavelength, 4, this.seed) *
      g.mountainAmplitude *
      (0.22 + 0.78 * relief);
    const hills =
      fbm(wx / g.hillWavelength + 7.3, wz / g.hillWavelength - 2.1, 4, this.seed + 50) *
      lerp(g.hillAmplitudeMin, g.hillAmplitudeMax, relief);
    const bumps =
      fbm(x / g.bumpWavelength, z / g.bumpWavelength, 2, this.seed + 90) * g.bumpAmplitude;

    // Winding channels carved below water level; dry canyons through ridges.
    const riverNoise = fbm(x / g.riverWavelength, z / g.riverWavelength, 2, this.seed + 30);
    const river =
      (1 - smoothstep(0.02, g.riverWidth, Math.abs(riverNoise))) *
      smoothstep(g.riverFadeStart, g.riverFadeEnd, r);

    let h = mountains + hills + bumps + g.baseHeight - river * (g.riverDepth + mountains * 0.45);
    // Blend toward a nearly-flat pad at the spawn point.
    const pad = 1 - smoothstep(g.spawnFlatInner, g.spawnFlatOuter, r);
    h = lerp(h, g.spawnHeight + bumps * g.spawnBumpScale, pad);
    return h;
  }
}

export interface RayHit {
  distance: number;
  point: Vec3;
  normal: Vec3;
  surface: SurfaceId;
}

const NORMAL_EPS = 0.4;
const RAY_STEP = 0.3;
const BISECT_ITERS = 8;

export class Terrain {
  constructor(
    private readonly source: HeightSource,
    private readonly seed: number = WORLD.seed,
  ) {}

  height(x: number, z: number): number {
    return this.source.height(x, z);
  }

  normal(x: number, z: number, out: Vec3): Vec3 {
    const e = NORMAL_EPS;
    const dx = this.height(x - e, z) - this.height(x + e, z);
    const dz = this.height(x, z - e) - this.height(x, z + e);
    return out.set(dx, 2 * e, dz).normalize();
  }

  biome(x: number, z: number): BiomeId {
    const h = this.height(x, z);
    const r = Math.hypot(x, z);
    const g = WORLD.gen;
    if (r < g.spawnFlatOuter * 1.15) return 'grassland';

    const e = NORMAL_EPS;
    const dx = this.height(x - e, z) - this.height(x + e, z);
    const dz = this.height(x, z - e) - this.height(x, z + e);
    const ny = (2 * e) / Math.hypot(dx, 2 * e, dz);
    const moisture = fbm(x / 320, z / 320, 3, this.seed + 140);
    const forest = fbm(x / 210 + 2.7, z / 210 - 5.1, 3, this.seed + 141);
    const ridge = ridgedFbm(x / 480 - 3.2, z / 480 + 1.4, 3, this.seed + 142);
    const riverNoise = fbm(x / g.riverWavelength, z / g.riverWavelength, 2, this.seed + 30);
    const nearRiver =
      Math.abs(riverNoise) < g.riverWidth * 1.65 && r > g.riverFadeStart && r < g.reliefEnd * 1.8;

    if (h > WORLD.snowLine - 3 + moisture * 2) return 'snowRidge';
    if (nearRiver && h < WORLD.waterLevel + 8) return 'riverValley';
    if (h < WORLD.waterLevel + 2.2 && moisture < -0.05) return 'sandyShore';
    if (h < WORLD.waterLevel + 5.2 && moisture > -0.25) return 'marsh';
    if (ny < WORLD.rockSlope + 0.04 || (h > 15 && ridge > 0.54)) return 'rockyHighlands';
    if (forest > -0.03 && h < 22 && ny > FOREST_MIN_NORMAL_Y) return 'pineForest';
    return 'grassland';
  }

  surface(x: number, z: number): SurfaceId {
    const h = this.height(x, z);
    if (h < WORLD.waterLevel) return 'water';
    if (h < WORLD.waterLevel + WORLD.sandShore) return 'sand';
    const biome = this.biome(x, z);
    if (biome === 'sandyShore' && h < WORLD.waterLevel + 2.8) return 'sand';

    const e = NORMAL_EPS;
    const dx = this.height(x - e, z) - this.height(x + e, z);
    const dz = this.height(x, z - e) - this.height(x, z + e);
    const ny = (2 * e) / Math.hypot(dx, 2 * e, dz);
    if (ny < WORLD.rockSlope) return 'rock';

    const w = WORLD.gen.patchWavelength;
    const patch = fbm(x / w, z / w, 2, this.seed + 777);
    if (h > WORLD.snowLine + patch * 4 || (biome === 'snowRidge' && h > WORLD.snowLine - 5)) {
      return 'snow';
    }
    // Mud/rock patches fade out near the spawn so the start is always grass.
    const gate =
      2 * (1 - smoothstep(WORLD.gen.spawnFlatInner, WORLD.gen.spawnFlatOuter, Math.hypot(x, z)));
    if ((biome === 'marsh' || biome === 'riverValley') && patch > -0.25 + gate && h < 12) {
      return 'mud';
    }
    if (patch > 0.5 + gate && h < 18) return 'mud';
    if (biome === 'rockyHighlands' && patch < 0.2 - gate) return 'rock';
    if (patch < -0.55 - gate) return 'rock';
    return 'grass';
  }

  /**
   * March a ray against the heightfield. Steps until the ray dips below the
   * surface, then bisects. Suited to short, mostly-downward wheel rays.
   */
  raycast(origin: Vec3, dir: Vec3, maxDist: number, out: RayHit): boolean {
    let tPrev = 0;
    if (origin.y - this.height(origin.x, origin.z) <= 0) {
      // Started inside the ground (hard landing): report an immediate hit.
      this.fillHit(origin, dir, 0, out);
      return true;
    }
    for (let t = RAY_STEP; t <= maxDist + RAY_STEP; t += RAY_STEP) {
      const tc = Math.min(t, maxDist);
      const x = origin.x + dir.x * tc;
      const y = origin.y + dir.y * tc;
      const z = origin.z + dir.z * tc;
      const d = y - this.height(x, z);
      if (d <= 0) {
        let lo = tPrev;
        let hi = tc;
        for (let i = 0; i < BISECT_ITERS; i++) {
          const mid = (lo + hi) / 2;
          const my =
            origin.y + dir.y * mid - this.height(origin.x + dir.x * mid, origin.z + dir.z * mid);
          if (my > 0) lo = mid;
          else hi = mid;
        }
        this.fillHit(origin, dir, (lo + hi) / 2, out);
        return true;
      }
      tPrev = tc;
      if (tc >= maxDist) break;
    }
    return false;
  }

  private fillHit(origin: Vec3, dir: Vec3, t: number, out: RayHit): void {
    out.distance = t;
    out.point.copy(origin).addScaled(dir, t);
    out.point.y = this.height(out.point.x, out.point.z);
    this.normal(out.point.x, out.point.z, out.normal);
    out.surface = this.surface(out.point.x, out.point.z);
  }
}

const FOREST_MIN_NORMAL_Y = 0.82;

export function makeRayHit(): RayHit {
  return { distance: 0, point: new Vec3(), normal: new Vec3(0, 1, 0), surface: 'grass' };
}
