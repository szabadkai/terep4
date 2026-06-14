/**
 * AI driver. Reads a racer's vehicle state plus its current target point and
 * produces an InputState — the exact same contract the player's keyboard
 * fills, so AI cars run through identical physics. The controller only
 * steers and modulates the pedals; everything else (grip, suspension,
 * obstacle bounce) emerges from the shared vehicle simulation.
 */

import { AI, type AiDriverProfile } from '../config';
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

export type AiRecoveryState = 'normal' | 'pause' | 'reverse' | 'crawl' | 'reset-if-hopeless';

export interface AiTelemetry {
  targetSpeed: number;
  bearingError: number;
  surfaceMultiplier: number;
  slideRatio: number;
  upright: number;
  tumbleRate: number;
  stuckTimer: number;
  progressTimer: number;
  unstickTimer: number;
  recoveryState: AiRecoveryState;
  recoveryTimer: number;
  stuckAttempts: number;
  resetRequested: boolean;
  rolloverTimer: number;
  profile: AiDriverProfile;
}

const NEUTRAL_PROFILE: AiDriverProfile = {
  aggression: 1,
  terrainCaution: 1,
  recoveryPatience: 1,
  brakeBias: 1,
  preferredSpeed: 1,
};

function makeTelemetry(profile: AiDriverProfile = NEUTRAL_PROFILE): AiTelemetry {
  return {
    targetSpeed: 0,
    bearingError: 0,
    surfaceMultiplier: 1,
    slideRatio: 0,
    upright: 1,
    tumbleRate: 0,
    stuckTimer: 0,
    progressTimer: 0,
    unstickTimer: 0,
    recoveryState: 'normal',
    recoveryTimer: 0,
    stuckAttempts: 0,
    resetRequested: false,
    rolloverTimer: 0,
    profile: { ...profile },
  };
}

export class AiDriver {
  readonly input: InputState = {
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: false,
    reset: false,
  };
  readonly telemetry: AiTelemetry;

  private stuckTimer = 0;
  private progressTimer = 0;
  private lastCpDist = Number.POSITIVE_INFINITY;
  private recoveryState: AiRecoveryState = 'normal';
  private recoveryTimer = 0;
  private checkpointIndex = -1;
  private stuckAttempts = 0;
  private resetQueued = false;
  private rolloverTimer = 0;

  constructor(
    private readonly skill: number,
    private readonly profile: AiDriverProfile = NEUTRAL_PROFILE,
  ) {
    this.telemetry = makeTelemetry(profile);
  }

  reset(): void {
    this.stuckTimer = 0;
    this.progressTimer = 0;
    this.lastCpDist = Number.POSITIVE_INFINITY;
    this.recoveryState = 'normal';
    this.recoveryTimer = 0;
    this.checkpointIndex = -1;
    this.stuckAttempts = 0;
    this.resetQueued = false;
    this.rolloverTimer = 0;
    this.input.throttle = 0;
    this.input.brake = 0;
    this.input.steer = 0;
    this.input.handbrake = false;
    this.input.reset = false;
    Object.assign(this.telemetry, makeTelemetry(this.profile));
  }

  takeResetRequest(): boolean {
    const requested = this.resetQueued;
    this.resetQueued = false;
    this.input.reset = false;
    this.telemetry.resetRequested = false;
    return requested;
  }

  acknowledgeVehicleReset(cpDist: number): void {
    this.resetStuckTracking(cpDist);
    this.rolloverTimer = 0;
    this.recoveryState = 'reset-if-hopeless';
    this.recoveryTimer = AI.recoveryResetHoldTime;
    this.input.throttle = 0;
    this.input.brake = 0;
    this.input.steer = 0;
    this.input.handbrake = false;
    this.input.reset = false;
    this.updateRecoveryTelemetry();
  }

  /**
   * Drive `vehicle` toward world point (tx, tz); returns the filled input.
   * `cpDist` is the distance to the actual checkpoint (not the lookahead aim
   * point), used to ease off near the gate so the turn radius tucks inside
   * the capture radius instead of orbiting it.
   */
  drive(
    vehicle: Vehicle,
    tx: number,
    tz: number,
    cpDist: number,
    checkpointIndex: number,
    dt: number,
  ): InputState {
    const { input } = this;
    input.reset = false;
    if (checkpointIndex !== this.checkpointIndex) {
      this.advanceCheckpoint(checkpointIndex, cpDist);
    }

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
    const waterCount = grounded.filter((w) => w.surface === 'water').length;
    const mostlyWater = groundedCount > 0 && waterCount / groundedCount >= 0.5;
    const slideRatio = groundedCount > 0 ? slidingCount / groundedCount : 0;
    const rawSurfaceMul =
      groundedCount > 0 ? Math.min(...grounded.map((w) => AI.surfaceSpeed[w.surface])) : 0.65;
    const surfaceMul = clamp(
      1 - (1 - rawSurfaceMul) * this.profile.terrainCaution,
      AI.minSurfaceSpeedMultiplier,
      1.08,
    );

    vehicle.body.localDirToWorld(localUp, up);
    const upright = clamp(up.y, 0, 1);
    const tiltMul = clamp((upright - AI.tiltDangerUp) / (AI.tiltCautionUp - AI.tiltDangerUp), 0, 1);
    const tumbleRate = Math.hypot(vehicle.body.angVel.x, vehicle.body.angVel.z);
    const tumbleMul = clamp(
      1 - (tumbleRate - AI.tumbleCautionRate) / (AI.tumbleDangerRate - AI.tumbleCautionRate),
      0,
      1,
    );
    this.telemetry.bearingError = error;
    this.telemetry.surfaceMultiplier = surfaceMul;
    this.telemetry.slideRatio = slideRatio;
    this.telemetry.upright = upright;
    this.telemetry.tumbleRate = tumbleRate;

    this.updateRolloverTimer(upright, dt);
    if (
      this.rolloverTimer > AI.recoveryRolloverTime &&
      this.recoveryState !== 'reset-if-hopeless'
    ) {
      this.beginResetIfHopeless(cpDist);
    }

    if (this.recoveryState !== 'normal') {
      return this.driveRecovery(error, forwardSpeed, cpDist, dt);
    }

    const progressRate = Number.isFinite(this.lastCpDist) ? (this.lastCpDist - cpDist) / dt : 0;
    this.lastCpDist = cpDist;
    const tryingToDrive = input.throttle > 0.35 || input.brake > 0.35;
    const terrainStuckSpeed = mostlyWater ? AI.stuckSpeed * 1.4 : AI.stuckSpeed;
    const stuckTime = AI.stuckTime * this.profile.recoveryPatience;
    const poorProgressTime = AI.poorProgressTime * this.profile.recoveryPatience;
    if (
      tryingToDrive &&
      cpDist > AI.captureRadius &&
      (speed < terrainStuckSpeed || (slideRatio > 0.5 && speed < terrainStuckSpeed * 2.2))
    ) {
      this.stuckTimer += dt;
    } else {
      this.stuckTimer = 0;
    }
    if (
      tryingToDrive &&
      cpDist > AI.captureRadius &&
      progressRate < AI.minProgressRate &&
      speed < terrainStuckSpeed * 1.9
    ) {
      this.progressTimer += dt;
    } else {
      this.progressTimer = Math.max(0, this.progressTimer - dt * 2);
    }
    if (this.stuckTimer > stuckTime || this.progressTimer > poorProgressTime) {
      this.beginRecoveryAttempt(cpDist);
      return this.driveRecovery(error, forwardSpeed, cpDist, dt);
    }
    this.telemetry.stuckTimer = this.stuckTimer;
    this.telemetry.progressTimer = this.progressTimer;

    // --- Steering: proportional to bearing error (negated for the steer
    // convention), sharper with higher skill.
    const aggression = this.profile.aggression;
    const brakeBias = this.profile.brakeBias;
    const steerSkill = this.skill * (0.92 + aggression * 0.08);
    input.steer = clamp(-AI.steerGain * steerSkill * error, -1, 1);

    // --- Pedals: chase a target speed instead of running every straight at
    // full power. The target drops for tight turns, poor surfaces, sliding,
    // and risky chassis attitude so the car has time to recover.
    const caution = AI.cautionAngle * (0.6 + 0.4 * this.skill) * (1.12 - aggression * 0.12);
    let targetSpeed =
      AI.cruiseSpeed *
      (0.78 + 0.22 * this.skill) *
      this.profile.preferredSpeed *
      (0.94 + aggression * 0.06);
    if (absErr > caution) {
      const brakeAngle = AI.brakeAngle * (1.1 - brakeBias * 0.1) * (0.92 + aggression * 0.08);
      const turnMul = clamp(1 - (absErr - caution) / (brakeAngle - caution), 0.24, 1);
      targetSpeed *= turnMul;
    }
    targetSpeed *= surfaceMul * clamp(0.35 + 0.65 * tiltMul, 0.35, 1) * tumbleMul;
    targetSpeed = Math.max(AI.minTargetSpeed, targetSpeed);
    this.telemetry.targetSpeed = targetSpeed;

    const speedError = targetSpeed - Math.max(0, forwardSpeed);
    input.throttle = clamp((speedError * aggression) / 7, 0, 1) * (0.7 + 0.3 * this.skill);
    input.brake =
      (forwardSpeed > targetSpeed + 2.5 / brakeBias ||
        (absErr > AI.brakeAngle * (1.08 - brakeBias * 0.08) && speed > AI.brakeSpeed)) &&
      forwardSpeed > AI.minTargetSpeed
        ? clamp(((forwardSpeed - targetSpeed) / 8) * brakeBias, 0.2 * brakeBias, 1)
        : 0;
    if (slideRatio > 0.5) {
      input.throttle *= clamp(
        AI.slideThrottle / Math.sqrt(this.profile.terrainCaution),
        0.34,
        0.58,
      );
      if (forwardSpeed > targetSpeed) input.brake = Math.max(input.brake, 0.35 * brakeBias);
    }

    // Near the gate but pointed away → we're about to orbit it. Brake to crawl
    // so the turn radius collapses and we can pivot in to capture it.
    if (cpDist < AI.approachDist && absErr > AI.approachAngle) {
      const tuck = clamp(cpDist / AI.approachDist, AI.approachThrottle, 1);
      input.throttle *= tuck;
      if (speed > AI.brakeSpeed && absErr > AI.brakeAngle * 0.6) input.brake = brakeBias;
    }
    if (tiltMul < 1 || tumbleMul < 1) {
      input.throttle *= Math.min(tiltMul, tumbleMul);
      if (forwardSpeed > AI.minTargetSpeed) input.brake = Math.max(input.brake, 0.4 * brakeBias);
    }
    input.handbrake = false;
    this.updateRecoveryTelemetry();
    return input;
  }

  private advanceCheckpoint(checkpointIndex: number, cpDist: number): void {
    this.checkpointIndex = checkpointIndex;
    this.stuckAttempts = 0;
    this.recoveryState = 'normal';
    this.recoveryTimer = 0;
    this.resetQueued = false;
    this.rolloverTimer = 0;
    this.resetStuckTracking(cpDist);
    this.updateRecoveryTelemetry();
  }

  private resetStuckTracking(cpDist: number): void {
    this.stuckTimer = 0;
    this.progressTimer = 0;
    this.lastCpDist = Number.isFinite(cpDist) ? cpDist : Number.POSITIVE_INFINITY;
  }

  private updateRolloverTimer(upright: number, dt: number): void {
    if (upright < AI.recoveryRolloverUp) {
      this.rolloverTimer += dt;
    } else {
      this.rolloverTimer = Math.max(0, this.rolloverTimer - dt * 2);
    }
  }

  private beginRecoveryAttempt(cpDist: number): void {
    this.stuckAttempts++;
    this.resetStuckTracking(cpDist);
    const maxAttempts = Math.max(
      1,
      Math.round(AI.recoveryMaxAttemptsPerCheckpoint * this.profile.recoveryPatience),
    );
    if (this.stuckAttempts >= maxAttempts) {
      this.beginResetIfHopeless(cpDist);
      return;
    }
    this.recoveryState = 'pause';
    this.recoveryTimer = AI.recoveryPauseTime * this.profile.recoveryPatience;
    this.updateRecoveryTelemetry();
  }

  private beginResetIfHopeless(cpDist: number): void {
    this.resetStuckTracking(cpDist);
    this.recoveryState = 'reset-if-hopeless';
    this.recoveryTimer = AI.recoveryResetHoldTime;
    this.resetQueued = true;
    this.input.reset = true;
    this.updateRecoveryTelemetry();
  }

  private driveRecovery(
    error: number,
    forwardSpeed: number,
    cpDist: number,
    dt: number,
  ): InputState {
    const { input } = this;
    input.handbrake = false;
    input.reset = this.resetQueued;

    switch (this.recoveryState) {
      case 'pause':
        this.telemetry.targetSpeed = 0;
        input.throttle = 0;
        input.brake = forwardSpeed > 0.5 ? 0.7 : 0;
        input.steer = 0;
        break;
      case 'reverse':
        this.telemetry.targetSpeed = 0;
        input.throttle = 0;
        input.brake = 1;
        input.steer = clamp(Math.sign(error) || 1, -1, 1);
        break;
      case 'crawl':
        this.telemetry.targetSpeed = AI.minTargetSpeed;
        input.throttle = forwardSpeed < AI.minTargetSpeed ? AI.recoveryCrawlThrottle : 0.08;
        input.brake = forwardSpeed > AI.minTargetSpeed + 1 ? 0.25 * this.profile.brakeBias : 0;
        input.steer = clamp(
          -AI.steerGain * this.skill * (0.92 + this.profile.aggression * 0.08) * error,
          -0.65,
          0.65,
        );
        break;
      case 'reset-if-hopeless':
        this.telemetry.targetSpeed = 0;
        input.throttle = 0;
        input.brake = this.resetQueued ? 1 : 0.35;
        input.steer = 0;
        break;
      case 'normal':
        this.telemetry.targetSpeed = 0;
        input.throttle = 0;
        input.brake = 0;
        input.steer = 0;
        break;
    }

    this.recoveryTimer = Math.max(0, this.recoveryTimer - dt);
    if (this.recoveryTimer <= 0) {
      this.advanceRecoveryPhase(cpDist);
    }
    this.updateRecoveryTelemetry();
    return input;
  }

  private advanceRecoveryPhase(cpDist: number): void {
    switch (this.recoveryState) {
      case 'pause':
        this.recoveryState = 'reverse';
        this.recoveryTimer =
          (AI.unstickTime + Math.max(0, this.stuckAttempts - 1) * AI.recoveryRepeatReverseBonus) *
          this.profile.recoveryPatience;
        break;
      case 'reverse':
        this.recoveryState = 'crawl';
        this.recoveryTimer = AI.recoveryCrawlTime * this.profile.recoveryPatience;
        break;
      case 'crawl':
        this.recoveryState = 'normal';
        this.recoveryTimer = 0;
        this.resetStuckTracking(cpDist);
        break;
      case 'reset-if-hopeless':
        this.recoveryState = 'crawl';
        this.recoveryTimer = AI.recoveryCrawlTime * this.profile.recoveryPatience;
        break;
      case 'normal':
        break;
    }
  }

  private updateRecoveryTelemetry(): void {
    const timer = Math.max(0, this.recoveryTimer);
    this.telemetry.stuckTimer = this.stuckTimer;
    this.telemetry.progressTimer = this.progressTimer;
    this.telemetry.unstickTimer = this.recoveryState === 'normal' ? 0 : timer;
    this.telemetry.recoveryState = this.recoveryState;
    this.telemetry.recoveryTimer = timer;
    this.telemetry.stuckAttempts = this.stuckAttempts;
    this.telemetry.resetRequested = this.resetQueued;
    this.telemetry.rolloverTimer = this.rolloverTimer;
  }
}
