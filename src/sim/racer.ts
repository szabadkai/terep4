/**
 * An AI opponent: a Vehicle driven by an AiDriver toward the shared
 * checkpoint loop, with its own progress and finish time. Tracks the same
 * checkpoints as the player's Race but advances independently, so standings
 * are just a comparison of (checkpoint index, time).
 */

import { AI, opponentConfig, type OpponentSpec, type SurfaceId } from '../config';
import { clamp, smoothstep } from '../core/math';
import type { Terrain } from '../terrain/terrain';
import type { Checkpoint } from './race';
import { Vehicle } from './vehicle';
import { AiDriver, type AiTelemetry } from './ai';

export class Racer {
  readonly vehicle: Vehicle;
  private readonly driver: AiDriver;
  private routeOffset = 0;
  current = 0;
  finished = false;
  finishTime: number | null = null;

  constructor(
    readonly spec: OpponentSpec,
    private readonly terrain: Terrain,
    private readonly checkpoints: readonly Checkpoint[],
  ) {
    this.vehicle = new Vehicle(opponentConfig(spec), terrain);
    this.driver = new AiDriver(spec.skill, spec.profile);
  }

  get telemetry(): AiTelemetry {
    return this.driver.telemetry;
  }

  distanceToCheckpoint(): number {
    if (this.finished) return 0;
    const cp = this.checkpoints[this.current];
    const pos = this.vehicle.body.pos;
    return Math.hypot(pos.x - cp.x, pos.z - cp.z);
  }

  /** Place on the start line, offset sideways so cars don't overlap. */
  reset(): void {
    this.vehicle.reset(this.spec.startOffset, 0, 0);
    this.driver.reset();
    this.current = 0;
    this.finished = false;
    this.finishTime = null;
    this.routeOffset = 0;
  }

  /**
   * Aim at the current checkpoint, but once we're within dynamic lookahead of it
   * start cutting toward the next one so the car carries speed through the
   * gate instead of braking for a hard apex. A small terrain sampler then
   * nudges the aim point left/right to avoid obvious mud/water/snow/rocks
   * when a nearby line is cheaper.
   */
  private target(dt: number): Checkpoint {
    const cp = this.checkpoints[this.current];
    const nextIdx = this.current + 1;

    const pos = this.vehicle.body.pos;
    let aim = cp;
    if (nextIdx < this.checkpoints.length) {
      const lookahead = this.lookaheadDistance();
      const distToCp = Math.hypot(pos.x - cp.x, pos.z - cp.z);
      if (distToCp <= lookahead) {
        const nxt = this.checkpoints[nextIdx];
        const dx = nxt.x - cp.x;
        const dz = nxt.z - cp.z;
        const len = Math.hypot(dx, dz) || 1;
        // Blend toward the next gate as we close in on the current one.
        const blend = (1 - distToCp / lookahead) * Math.min(lookahead, len * 0.5);
        aim = { x: cp.x + (dx / len) * blend, z: cp.z + (dz / len) * blend };
      }
    }

    return this.terrainAwareAim(aim, dt);
  }

  private lookaheadDistance(): number {
    const speed = Math.max(0, this.vehicle.forwardSpeed());
    const t = clamp(speed / AI.lookaheadSpeed, 0, 1);
    return AI.lookaheadMin + (AI.lookaheadMax - AI.lookaheadMin) * smoothstep(0, 1, t);
  }

  private terrainAwareAim(base: Checkpoint, dt: number): Checkpoint {
    const pos = this.vehicle.body.pos;
    const dx = base.x - pos.x;
    const dz = base.z - pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < AI.captureRadius * 1.4) {
      this.routeOffset += (0 - this.routeOffset) * clamp(AI.avoidOffsetSmoothing * dt, 0, 1);
      return base;
    }

    const escape = this.escapeBadSurface(dx, dz, dist);
    if (escape) {
      this.routeOffset += (0 - this.routeOffset) * clamp(AI.avoidOffsetSmoothing * dt, 0, 1);
      return escape;
    }

    const ux = dx / dist;
    const uz = dz / dist;
    const px = -uz;
    const pz = ux;
    const scanDist = Math.min(dist, AI.avoidScanDist);
    const offsets = [
      -AI.avoidLateralOffset,
      -AI.avoidLateralOffset * 0.55,
      0,
      AI.avoidLateralOffset * 0.55,
      AI.avoidLateralOffset,
    ];
    let bestOffset = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const offset of offsets) {
      const score = this.routeScore(pos.x, pos.z, ux, uz, px, pz, scanDist, offset);
      if (score < bestScore) {
        bestScore = score;
        bestOffset = offset;
      }
    }

    this.routeOffset += (bestOffset - this.routeOffset) * clamp(AI.avoidOffsetSmoothing * dt, 0, 1);
    const fadeNearGate = smoothstep(AI.captureRadius * 1.6, AI.avoidScanDist * 0.8, dist);
    const offset = this.routeOffset * fadeNearGate;
    return { x: pos.x + ux * scanDist + px * offset, z: pos.z + uz * scanDist + pz * offset };
  }

  private escapeBadSurface(dx: number, dz: number, distToTarget: number): Checkpoint | null {
    if (distToTarget < AI.escapeScanDist * 0.75) return null;

    const pos = this.vehicle.body.pos;
    const here = this.terrain.surface(pos.x, pos.z);
    if (
      here !== 'water' &&
      !(here === 'mud' && this.vehicle.body.vel.length() < AI.stuckSpeed * 2)
    ) {
      return null;
    }

    const baseBearing = Math.atan2(dx, dz);
    const candidates = [0, -0.55, 0.55, -1.1, 1.1, -1.7, 1.7, Math.PI];
    let bestBearing = baseBearing;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const delta of candidates) {
      const bearing = baseBearing + delta;
      const sx = Math.sin(bearing);
      const sz = Math.cos(bearing);
      let score = Math.abs(delta) * 7;
      for (const d of [12, 24, 40, AI.escapeScanDist]) {
        const surface = this.terrain.surface(pos.x + sx * d, pos.z + sz * d);
        score +=
          SURFACE_ROUTE_PENALTY[surface] * this.spec.profile.terrainCaution * (d < 24 ? 1.5 : 1);
      }
      if (score < bestScore) {
        bestScore = score;
        bestBearing = bearing;
      }
    }

    const directPenalty = this.routeScore(
      pos.x,
      pos.z,
      dx / distToTarget,
      dz / distToTarget,
      0,
      0,
      Math.min(distToTarget, AI.escapeScanDist),
      0,
    );
    if (bestScore >= directPenalty * 0.8) return null;
    return {
      x: pos.x + Math.sin(bestBearing) * AI.escapeScanDist,
      z: pos.z + Math.cos(bestBearing) * AI.escapeScanDist,
    };
  }

  private routeScore(
    x: number,
    z: number,
    ux: number,
    uz: number,
    px: number,
    pz: number,
    scanDist: number,
    offset: number,
  ): number {
    let score = Math.abs(offset) * 0.14;
    const samples = 6;
    let prevH = this.terrain.height(x, z);
    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      const sx = x + ux * scanDist * t + px * offset * t;
      const sz = z + uz * scanDist * t + pz * offset * t;
      const h = this.terrain.height(sx, sz);
      const surface = this.terrain.surface(sx, sz);
      const slope = Math.abs(h - prevH) / (scanDist / samples);
      score += SURFACE_ROUTE_PENALTY[surface] * this.spec.profile.terrainCaution * (1.2 - t * 0.25);
      score += Math.max(0, slope - 0.22) * 32;
      prevH = h;
    }
    return score;
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
    const aim = this.target(dt);
    const input = running
      ? this.driver.drive(this.vehicle, aim.x, aim.z, cpDist, this.current, dt)
      : this.driver.input;
    if (this.driver.takeResetRequest()) {
      const resetPoint = this.recoveryResetPoint(cp);
      this.vehicle.reset(resetPoint.x, resetPoint.z, this.vehicle.yaw());
      this.driver.acknowledgeVehicleReset(Math.hypot(resetPoint.x - cp.x, resetPoint.z - cp.z));
      this.routeOffset = 0;
    }
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

  private recoveryResetPoint(cp: Checkpoint): Checkpoint {
    const pos = this.vehicle.body.pos;
    const dx = cp.x - pos.x;
    const dz = cp.z - pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    const ux = dx / dist;
    const uz = dz / dist;
    const px = -uz;
    const pz = ux;
    const baseDist = dist;

    let best = { x: pos.x, z: pos.z };
    let bestScore = this.resetPointScore(best.x, best.z, pos.x, pos.z, cp, baseDist);
    for (const forward of [12, 24, 38, 54]) {
      for (const lateral of [-22, -11, 0, 11, 22]) {
        const x = pos.x + ux * forward + px * lateral;
        const z = pos.z + uz * forward + pz * lateral;
        const score = this.resetPointScore(x, z, pos.x, pos.z, cp, baseDist);
        if (score < bestScore) {
          bestScore = score;
          best = { x, z };
        }
      }
    }
    return best;
  }

  private resetPointScore(
    x: number,
    z: number,
    fromX: number,
    fromZ: number,
    cp: Checkpoint,
    baseDist: number,
  ): number {
    const surface = this.terrain.surface(x, z);
    const height = this.terrain.height(x, z);
    const cpDist = Math.hypot(cp.x - x, cp.z - z);
    const moveDist = Math.hypot(x - fromX, z - fromZ);
    const progress = baseDist - cpDist;
    return (
      SURFACE_RESET_PENALTY[surface] +
      Math.max(0, 0.8 - height) * 40 +
      Math.max(0, -progress) * 0.12 -
      progress * 0.18 +
      moveDist * 0.06
    );
  }
}

const SURFACE_ROUTE_PENALTY: Record<SurfaceId, number> = {
  grass: 0,
  rock: 7,
  mud: 18,
  sand: 5,
  snow: 13,
  water: 56,
};

const SURFACE_RESET_PENALTY: Record<SurfaceId, number> = {
  grass: 0,
  rock: 12,
  mud: 34,
  sand: 8,
  snow: 18,
  water: 90,
};
