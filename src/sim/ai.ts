/**
 * AI driver. Reads a racer's vehicle state plus its current target point and
 * produces an InputState — the exact same contract the player's keyboard
 * fills, so AI cars run through identical physics. The controller only
 * steers and modulates the pedals; everything else (grip, suspension,
 * obstacle bounce) emerges from the shared vehicle simulation.
 */

import { AI } from '../config';
import { clamp } from '../core/math';
import type { InputState } from '../input/input';
import type { Vehicle } from './vehicle';

/** Shortest signed angle a→b in (-π, π]. */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class AiDriver {
  readonly input: InputState = {
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: false,
    reset: false,
  };

  private stuckTimer = 0;
  private unstickTimer = 0;

  constructor(private readonly skill: number) {}

  reset(): void {
    this.stuckTimer = 0;
    this.unstickTimer = 0;
    this.input.throttle = 0;
    this.input.brake = 0;
    this.input.steer = 0;
    this.input.handbrake = false;
  }

  /**
   * Drive `vehicle` toward world point (tx, tz); returns the filled input.
   * `cpDist` is the distance to the actual checkpoint (not the lookahead aim
   * point), used to ease off near the gate so the turn radius tucks inside
   * the capture radius instead of orbiting it.
   */
  drive(vehicle: Vehicle, tx: number, tz: number, cpDist: number, dt: number): InputState {
    const { input } = this;
    const pos = vehicle.body.pos;
    const vel = vehicle.body.vel;
    const speed = Math.hypot(vel.x, vel.z);

    // Bearing to target vs. current heading. Note: positive input.steer turns
    // the car toward -X, which *decreases* yaw = atan2(forward.x, forward.z).
    // So steering is the negated bearing error (see below).
    const bearing = Math.atan2(tx - pos.x, tz - pos.z);
    const error = angleDelta(vehicle.yaw(), bearing);

    // --- Stuck detection: little progress for a while → reverse to unstick.
    if (this.unstickTimer > 0) {
      this.unstickTimer -= dt;
      input.throttle = 0;
      input.brake = 1; // brake reverses once the car is nearly stopped
      input.handbrake = false;
      // Counter-steer (negated convention) so reversing curls us toward the
      // target heading instead of deeper into the obstacle.
      input.steer = clamp(Math.sign(error) || 1, -1, 1);
      if (this.unstickTimer <= 0) this.stuckTimer = 0;
      return input;
    }
    if (speed < AI.stuckSpeed) {
      this.stuckTimer += dt;
      if (this.stuckTimer > AI.stuckTime) {
        this.unstickTimer = AI.unstickTime;
      }
    } else {
      this.stuckTimer = 0;
    }

    // --- Steering: proportional to bearing error (negated for the steer
    // convention), sharper with higher skill.
    input.steer = clamp(-AI.steerGain * this.skill * error, -1, 1);

    // --- Pedals: full throttle on a clear line; ease and brake into hard
    // turns, scaled so less-skilled drivers lift earlier and brake harder.
    const absErr = Math.abs(error);
    const caution = AI.cautionAngle * (0.6 + 0.4 * this.skill);
    let throttle = 1;
    if (absErr > caution) {
      throttle = clamp(1 - (absErr - caution) / (AI.brakeAngle - caution), 0.25, 1);
    }
    input.throttle = throttle * (0.7 + 0.3 * this.skill);
    input.brake = absErr > AI.brakeAngle && speed > AI.brakeSpeed ? 1 : 0;

    // Near the gate but pointed away → we're about to orbit it. Brake to crawl
    // so the turn radius collapses and we can pivot in to capture it.
    if (cpDist < AI.approachDist && absErr > AI.approachAngle) {
      const tuck = clamp(cpDist / AI.approachDist, AI.approachThrottle, 1);
      input.throttle *= tuck;
      if (speed > AI.brakeSpeed && absErr > AI.brakeAngle * 0.6) input.brake = 1;
    }
    input.handbrake = false;
    return input;
  }
}
