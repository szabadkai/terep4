/**
 * AI driver. Reads a racer's vehicle state plus its current target point and
 * produces an InputState — the exact same contract the player's keyboard
 * fills, so AI cars run through identical physics. The controller only
 * steers and modulates the pedals; everything else (grip, suspension,
 * obstacle bounce) emerges from the shared vehicle simulation.
 */

import { AI } from '../config';
import { Vec3, clamp } from '../core/math';
import type { InputState } from '../input/input';
import type { Vehicle } from './vehicle';

/** Shortest signed angle a→b in (-π, π]. */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

const localUp = new Vec3(0, 1, 0);
const up = new Vec3();

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
  private progressTimer = 0;
  private lastCpDist = Number.POSITIVE_INFINITY;

  constructor(private readonly skill: number) {}

  reset(): void {
    this.stuckTimer = 0;
    this.unstickTimer = 0;
    this.progressTimer = 0;
    this.lastCpDist = Number.POSITIVE_INFINITY;
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
    const forwardSpeed = vehicle.forwardSpeed();

    // Bearing to target vs. current heading. Note: positive input.steer turns
    // the car toward -X, which *decreases* yaw = atan2(forward.x, forward.z).
    // So steering is the negated bearing error (see below).
    const bearing = Math.atan2(tx - pos.x, tz - pos.z);
    const error = angleDelta(vehicle.yaw(), bearing);
    const absErr = Math.abs(error);

    const grounded = vehicle.wheels.filter((w) => w.grounded);
    const groundedCount = grounded.length;
    const slidingCount = grounded.filter((w) => w.sliding).length;
    const slideRatio = groundedCount > 0 ? slidingCount / groundedCount : 0;
    const surfaceMul =
      groundedCount > 0
        ? Math.min(...grounded.map((w) => AI.surfaceSpeed[w.surface]))
        : 0.65;

    vehicle.body.localDirToWorld(localUp, up);
    const upright = clamp(up.y, 0, 1);
    const tiltMul = clamp((upright - AI.tiltDangerUp) / (AI.tiltCautionUp - AI.tiltDangerUp), 0, 1);
    const tumbleRate = Math.hypot(vehicle.body.angVel.x, vehicle.body.angVel.z);
    const tumbleMul = clamp(
      1 - (tumbleRate - AI.tumbleCautionRate) / (AI.tumbleDangerRate - AI.tumbleCautionRate),
      0,
      1,
    );

    // --- Stuck detection: little progress for a while → reverse to unstick.
    if (this.unstickTimer > 0) {
      this.unstickTimer -= dt;
      input.throttle = 0;
      input.brake = 1; // brake reverses once the car is nearly stopped
      input.handbrake = false;
      // Counter-steer (negated convention) so reversing curls us toward the
      // target heading instead of deeper into the obstacle.
      input.steer = clamp(Math.sign(error) || 1, -1, 1);
      if (this.unstickTimer <= 0) {
        this.stuckTimer = 0;
        this.progressTimer = 0;
        this.lastCpDist = cpDist;
      }
      return input;
    }

    const progressRate = Number.isFinite(this.lastCpDist) ? (this.lastCpDist - cpDist) / dt : 0;
    this.lastCpDist = cpDist;
    if (speed < AI.stuckSpeed || (slideRatio > 0.5 && speed < AI.stuckSpeed * 2.6)) {
      this.stuckTimer += dt;
    } else {
      this.stuckTimer = 0;
    }
    if (progressRate < AI.minProgressRate && speed < AI.brakeSpeed * 0.45) {
      this.progressTimer += dt;
    } else {
      this.progressTimer = Math.max(0, this.progressTimer - dt * 2);
    }
    if (this.stuckTimer > AI.stuckTime || this.progressTimer > AI.poorProgressTime) {
      this.unstickTimer = AI.unstickTime;
      input.throttle = 0;
      input.brake = 1;
      input.handbrake = false;
      input.steer = clamp(Math.sign(error) || 1, -1, 1);
      return input;
    }

    // --- Steering: proportional to bearing error (negated for the steer
    // convention), sharper with higher skill.
    input.steer = clamp(-AI.steerGain * this.skill * error, -1, 1);

    // --- Pedals: chase a target speed instead of running every straight at
    // full power. The target drops for tight turns, poor surfaces, sliding,
    // and risky chassis attitude so the car has time to recover.
    const caution = AI.cautionAngle * (0.6 + 0.4 * this.skill);
    let targetSpeed = AI.cruiseSpeed * (0.78 + 0.22 * this.skill);
    if (absErr > caution) {
      const turnMul = clamp(1 - (absErr - caution) / (AI.brakeAngle - caution), 0.28, 1);
      targetSpeed *= turnMul;
    }
    targetSpeed *= surfaceMul * clamp(0.35 + 0.65 * tiltMul, 0.35, 1) * tumbleMul;
    targetSpeed = Math.max(AI.minTargetSpeed, targetSpeed);

    const speedError = targetSpeed - Math.max(0, forwardSpeed);
    input.throttle = clamp(speedError / 7, 0, 1) * (0.7 + 0.3 * this.skill);
    input.brake =
      (forwardSpeed > targetSpeed + 2.5 || (absErr > AI.brakeAngle && speed > AI.brakeSpeed)) &&
      forwardSpeed > AI.minTargetSpeed
        ? clamp((forwardSpeed - targetSpeed) / 8, 0.25, 1)
        : 0;
    if (slideRatio > 0.5) {
      input.throttle *= AI.slideThrottle;
      if (forwardSpeed > targetSpeed) input.brake = Math.max(input.brake, 0.35);
    }

    // Near the gate but pointed away → we're about to orbit it. Brake to crawl
    // so the turn radius collapses and we can pivot in to capture it.
    if (cpDist < AI.approachDist && absErr > AI.approachAngle) {
      const tuck = clamp(cpDist / AI.approachDist, AI.approachThrottle, 1);
      input.throttle *= tuck;
      if (speed > AI.brakeSpeed && absErr > AI.brakeAngle * 0.6) input.brake = 1;
    }
    if (tiltMul < 1 || tumbleMul < 1) {
      input.throttle *= Math.min(tiltMul, tumbleMul);
      if (forwardSpeed > AI.minTargetSpeed) input.brake = Math.max(input.brake, 0.4);
    }
    input.handbrake = false;
    return input;
  }
}
