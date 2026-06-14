/**
 * Deterministic 2D value noise. Pure functions of (x, z, seed) so the sim
 * and the renderer always agree on the terrain without sharing state.
 */

/** Integer-lattice hash → [0, 1). Stable for a given (ix, iz, seed). */
export function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Smoothly interpolated value noise in [-1, 1]. */
export function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const u = fade(x - ix);
  const v = fade(z - iz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  const value = a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  return value * 2 - 1;
}

/** Fractal Brownian motion: `octaves` layers of value noise, in ~[-1, 1]. */
export function fbm(x: number, z: number, octaves: number, seed: number): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * frequency, z * frequency, seed + i * 101) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03; // not exactly 2 to avoid lattice alignment artifacts
  }
  return sum / norm;
}

/** Ridged fbm in ~[0, 1]: sharp crests where the noise crosses zero. */
export function ridgedFbm(x: number, z: number, octaves: number, seed: number): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(valueNoise(x * frequency, z * frequency, seed + i * 131));
    n *= n;
    sum += n * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.07;
  }
  return sum / norm;
}
