/**
 * Checkpoint race, Terep2-style: a deterministic loop of checkpoints around
 * the spawn. The clock starts after a short staged countdown, each checkpoint
 * is captured by proximity, and passing the last one finishes the run. Pure
 * sim logic — rendering of gates and timers lives in the render layer.
 */

import { RACE, WORLD } from '../config';
import { hash2 } from '../terrain/noise';
import type { Terrain } from '../terrain/terrain';

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
  current = 0;
  phase: RacePhase = 'ready';
  elapsed = 0;
  countdownRemaining = 0;
  finishTime: number | null = null;

  constructor(terrain: Terrain, seed: number) {
    const n = RACE.checkpointCount;
    for (let i = 0; i < n; i++) {
      // Evenly around a ring with jitter; index 0 starts straight ahead (+Z).
      const slot = (TWO_PI / n) * i;
      const angle = slot + (hash2(i, 1, seed) - 0.5) * (TWO_PI / n) * 0.6;
      let radius = RACE.ringRadius + (hash2(i, 2, seed) - 0.5) * 2 * RACE.ringJitter;

      // Push flooded spots outward until the checkpoint sits on dry land.
      let x = Math.sin(angle) * radius;
      let z = Math.cos(angle) * radius;
      for (let tries = 0; tries < RACE.landSearchTries; tries++) {
        if (terrain.height(x, z) > WORLD.waterLevel + RACE.minLandHeight) break;
        radius += RACE.landSearchStep;
        x = Math.sin(angle) * radius;
        z = Math.cos(angle) * radius;
      }
      this.checkpoints.push({ x, z });
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
    if (Math.hypot(x - cp.x, z - cp.z) < RACE.captureRadius) {
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
