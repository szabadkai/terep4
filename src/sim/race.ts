/**
 * Checkpoint race, Terep2-style: a deterministic loop of checkpoints around
 * the spawn. The clock starts after a short staged countdown, each checkpoint
 * is captured by proximity, and passing the last one finishes the run. Pure
 * sim logic — rendering of gates and timers lives in the render layer.
 */

import { RACE, WORLD } from '../config';
import { Vec3 } from '../core/math';
import { hash2 } from '../terrain/noise';
import type { Terrain } from '../terrain/terrain';
import {
  DEFAULT_COURSE_SELECTION,
  coursePreset,
  type CoursePreset,
  type CoursePresetSelection,
} from './coursePreset';

export interface Checkpoint {
  x: number;
  z: number;
}

export type RacePhase = 'ready' | 'countdown' | 'running' | 'finished';

/** Plain-data view of one entrant's standing (player or AI). */
export interface Standing {
  name: string;
  /** Body paint color, for the HUD swatch; null = the player. */
  color: number | null;
  /** Checkpoints captured so far. */
  progress: number;
  finished: boolean;
  /** Finish time if finished, else null. */
  time: number | null;
  isPlayer: boolean;
}

/** Plain-data view of race progress for the render layer. */
export interface RaceState {
  phase: RacePhase;
  current: number;
  count: number;
  elapsed: number;
  countdownRemaining: number;
  finishTime: number | null;
  next: Checkpoint | null;
  /** 1-based finishing-order position of the player among all entrants. */
  position: number;
  total: number;
  /** All entrants, sorted leader-first. */
  standings: Standing[];
}

export class Race {
  readonly checkpoints: Checkpoint[] = [];
  readonly preset: CoursePreset;
  current = 0;
  phase: RacePhase = 'ready';
  elapsed = 0;
  countdownRemaining = 0;
  finishTime: number | null = null;

  constructor(
    terrain: Terrain,
    seed: number,
    selection: CoursePresetSelection = DEFAULT_COURSE_SELECTION,
  ) {
    this.preset = coursePreset(selection);
    const n = this.preset.checkpointCount;
    const usedZones = new Set<number>();
    let previous: Checkpoint = { x: 0, z: 0 };
    for (let i = 0; i < n; i++) {
      const cp = checkpointCandidate(terrain, seed, i, n, usedZones, previous, this.preset);
      const zone = terrain.locationZone(cp.x, cp.z);
      if (zone) usedZones.add(zone.id);
      this.checkpoints.push(cp);
      previous = cp;
    }
  }

  restart(): void {
    this.current = 0;
    this.phase = 'ready';
    this.elapsed = 0;
    this.countdownRemaining = 0;
    this.finishTime = null;
  }

  startCountdown(): void {
    this.current = 0;
    this.phase = 'countdown';
    this.elapsed = 0;
    this.countdownRemaining = RACE.countdownSeconds;
    this.finishTime = null;
  }

  step(dt: number, x: number, z: number): void {
    if (this.phase === 'finished') return;
    if (this.phase === 'ready') return;
    if (this.phase === 'countdown') {
      this.countdownRemaining = Math.max(0, this.countdownRemaining - dt);
      if (this.countdownRemaining <= 0) {
        this.phase = 'running';
      }
      return;
    }

    this.elapsed += dt;

    const cp = this.checkpoints[this.current];
    if (Math.hypot(x - cp.x, z - cp.z) < this.preset.captureRadius) {
      this.current++;
      if (this.current >= this.checkpoints.length) {
        this.phase = 'finished';
        this.finishTime = this.elapsed;
      }
    }
  }

  fillState(out: RaceState): void {
    out.phase = this.phase;
    out.current = this.current;
    out.count = this.checkpoints.length;
    out.elapsed = this.elapsed;
    out.countdownRemaining = this.countdownRemaining;
    out.finishTime = this.finishTime;
    out.next = this.phase === 'finished' ? null : this.checkpoints[this.current];
  }
}

const TWO_PI = Math.PI * 2;

function checkpointCandidate(
  terrain: Terrain,
  seed: number,
  index: number,
  count: number,
  usedZones: ReadonlySet<number>,
  previous: Checkpoint,
  preset: CoursePreset,
): Checkpoint {
  let best: Checkpoint | null = null;
  let bestScore = -Infinity;
  for (let c = 0; c < 10; c++) {
    const slot = (TWO_PI / count) * index;
    const angle = slot + (hash2(index, 20 + c, seed) - 0.5) * (TWO_PI / count) * 0.82;
    let radius = preset.ringRadius + (hash2(index, 40 + c, seed) - 0.5) * 2 * preset.ringJitter;

    let x = Math.sin(angle) * radius;
    let z = Math.cos(angle) * radius;
    for (let tries = 0; tries < RACE.landSearchTries; tries++) {
      if (terrain.height(x, z) > WORLD.waterLevel + preset.minLandHeight) break;
      radius += RACE.landSearchStep;
      x = Math.sin(angle) * radius;
      z = Math.cos(angle) * radius;
    }

    const zone = terrain.locationZone(x, z);
    const zoneScore = zone ? (usedZones.has(zone.id) ? 0.12 : 0.92) : 0;
    const ringScore = 1 - Math.abs(radius - preset.ringRadius) / Math.max(1, preset.ringJitter * 2);
    const dryScore = Math.min(1, (terrain.height(x, z) - WORLD.waterLevel) / 8);
    const score =
      routeEase(terrain, previous, { x, z }) * preset.terrainSafety +
      zoneScore +
      ringScore * 0.24 +
      dryScore * 0.18;
    if (score > bestScore) {
      best = { x, z };
      bestScore = score;
    }
  }
  return best ?? { x: 0, z: preset.ringRadius };
}

function routeEase(terrain: Terrain, a: Checkpoint, b: Checkpoint): number {
  let penalty = 0;
  const normal = new Vec3();
  const samples = 10;
  for (let i = 1; i <= samples; i++) {
    const t = i / (samples + 1);
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    const surface = terrain.surface(x, z);
    const slopeY = terrain.normal(x, z, normal).y;
    penalty +=
      surface === 'water'
        ? 1.6
        : surface === 'mud'
          ? 0.55
          : surface === 'snow'
            ? 0.45
            : surface === 'rock'
              ? 0.32
              : surface === 'sand'
                ? 0.22
                : 0;
    if (slopeY < 0.72) penalty += (0.72 - slopeY) * 2.2;
  }
  return 1 - penalty / samples;
}
