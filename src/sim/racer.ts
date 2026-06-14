/**
 * An AI opponent: a Vehicle driven by an AiDriver toward the shared
 * checkpoint loop, with its own progress and finish time. Tracks the same
 * checkpoints as the player's Race but advances independently, so standings
 * are just a comparison of (checkpoint index, time).
 */

import { AI, opponentConfig, type OpponentSpec } from '../config';
import type { Terrain } from '../terrain/terrain';
import type { Checkpoint } from './race';
import { Vehicle } from './vehicle';
import { AiDriver } from './ai';

export class Racer {
  readonly vehicle: Vehicle;
  private readonly driver: AiDriver;
  current = 0;
  finished = false;
  finishTime: number | null = null;

  constructor(
    readonly spec: OpponentSpec,
    terrain: Terrain,
    private readonly checkpoints: readonly Checkpoint[],
  ) {
    this.vehicle = new Vehicle(opponentConfig(spec), terrain);
    this.driver = new AiDriver(spec.skill);
  }

  /** Place on the start line, offset sideways so cars don't overlap. */
  reset(): void {
    this.vehicle.reset(this.spec.startOffset, 0, 0);
    this.driver.reset();
    this.current = 0;
    this.finished = false;
    this.finishTime = null;
  }

  /**
   * Aim at the current checkpoint, but once we're within `lookahead` of it
   * start cutting toward the next one so the car carries speed through the
   * gate instead of braking for a hard apex. Far from the gate we aim
   * straight at it, so the lookahead never pulls the car off the line.
   */
  private target(): Checkpoint {
    const cp = this.checkpoints[this.current];
    const nextIdx = this.current + 1;
    if (nextIdx >= this.checkpoints.length) return cp;

    const pos = this.vehicle.body.pos;
    const distToCp = Math.hypot(pos.x - cp.x, pos.z - cp.z);
    if (distToCp > AI.lookahead) return cp;

    const nxt = this.checkpoints[nextIdx];
    const dx = nxt.x - cp.x;
    const dz = nxt.z - cp.z;
    const len = Math.hypot(dx, dz) || 1;
    // Blend toward the next gate as we close in on the current one.
    const blend = (1 - distToCp / AI.lookahead) * Math.min(AI.lookahead, len * 0.5);
    return { x: cp.x + (dx / len) * blend, z: cp.z + (dz / len) * blend };
  }

  /** Step the opponent; `clock` is the shared race elapsed time. */
  step(dt: number, running: boolean, clock: number): void {
    if (this.finished) {
      // Coast to a stop after finishing.
      this.driver.reset();
      this.vehicle.step(this.driver.input, dt);
      return;
    }

    const cp = this.checkpoints[this.current];
    const pos = this.vehicle.body.pos;
    const cpDist = Math.hypot(pos.x - cp.x, pos.z - cp.z);
    const aim = this.target();
    const input = running
      ? this.driver.drive(this.vehicle, aim.x, aim.z, cpDist, dt)
      : this.driver.input;
    this.vehicle.step(input, dt);

    if (!running) return;
    if (cpDist < AI.captureRadius) {
      this.current++;
      if (this.current >= this.checkpoints.length) {
        this.finished = true;
        this.finishTime = clock;
      }
    }
  }
}
