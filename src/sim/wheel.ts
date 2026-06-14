/**
 * One raycast wheel: spring-damper suspension plus a friction-circle tire
 * model. Forces are computed at the terrain contact point and applied to the
 * chassis body, so weight transfer, body roll and slides all emerge from the
 * rigid-body dynamics rather than being scripted.
 */

import { Vec3, clamp } from '../core/math';
import { SURFACES, WORLD, type SurfaceId, type VehicleConfig, type WheelConfig } from '../config';
import type { RigidBody } from './rigidbody';
import { type Terrain, type RayHit, makeRayHit } from '../terrain/terrain';

export interface WheelStepCtx {
  body: RigidBody;
  terrain: Terrain;
  dt: number;
  /** Signed drive force along the wheel's forward direction (N). */
  drive: number;
  /** Brake force from the pedal, per wheel (N, >= 0). */
  brake: number;
  handbrake: boolean;
  /** This wheel's share of vehicle mass, for slip-kill force clamps (kg). */
  shareMass: number;
}

const TWO_PI = Math.PI * 2;
/** Airborne driven wheels spin up toward this rate (rad/s). */
const FREE_SPIN_RATE = 25;

const attach = new Vec3();
const down = new Vec3();
const localDown = new Vec3(0, -1, 0);
const fw = new Vec3();
const fwLocal = new Vec3();
const right = new Vec3();
const vContact = new Vec3();
const force = new Vec3();

export class Wheel {
  steer = 0;
  spinAngle = 0;
  spinVel = 0;
  suspLen: number;
  grounded = false;
  sliding = false;
  surface: SurfaceId = 'grass';
  load = 0;

  private prevCompression = 0;
  private readonly hit: RayHit = makeRayHit();

  constructor(
    readonly cfg: WheelConfig,
    private readonly vehicle: VehicleConfig,
  ) {
    this.suspLen = vehicle.suspension.restLength;
  }

  rest(): void {
    this.suspLen = this.vehicle.suspension.restLength;
    this.prevCompression = 0;
    this.spinVel = 0;
    this.grounded = false;
    this.sliding = false;
  }

  step(ctx: WheelStepCtx): void {
    const susp = this.vehicle.suspension;
    const { body, dt } = ctx;

    body.localToWorld(toVec(this.cfg.offset), attach);
    body.localDirToWorld(localDown, down);
    const rayLen = susp.restLength + this.cfg.radius;

    if (!ctx.terrain.raycast(attach, down, rayLen, this.hit)) {
      this.grounded = false;
      this.sliding = false;
      this.load = 0;
      this.prevCompression = 0;
      // Visual droop toward full extension; free spin if driven.
      this.suspLen += (susp.restLength - this.suspLen) * clamp(8 * dt, 0, 1);
      const target = ctx.drive !== 0 ? Math.sign(ctx.drive) * FREE_SPIN_RATE : 0;
      this.spinVel += (target - this.spinVel) * clamp(3 * dt, 0, 1);
      this.advanceSpin(dt);
      return;
    }

    this.grounded = true;
    this.surface = this.hit.surface;

    // --- Suspension: spring + speed-dependent damper + progressive bump stop.
    this.suspLen = clamp(
      this.hit.distance - this.cfg.radius,
      susp.restLength - susp.maxTravel,
      susp.restLength,
    );
    const compression = susp.restLength - this.suspLen;
    const compVel = (compression - this.prevCompression) / dt;
    this.prevCompression = compression;

    let springForce = susp.stiffness * compression;
    const bumpZone = susp.maxTravel * susp.bumpStopAt;
    if (compression > bumpZone) springForce += susp.bumpStopStiffness * (compression - bumpZone);
    const damping = compVel > 0 ? susp.dampingCompression : susp.dampingRebound;
    springForce += damping * compVel;
    springForce = Math.max(0, springForce);
    this.load = springForce;

    force.copy(down).scale(-springForce);
    body.applyForce(force, this.hit.point);

    // --- Tire frame: wheel forward projected onto the contact plane.
    // Chassis space is +Z forward, +Y up, so the car's right side is -X:
    // positive steer must swing the wheel toward -X.
    const n = this.hit.normal;
    fwLocal.set(-Math.sin(this.steer), 0, Math.cos(this.steer));
    body.localDirToWorld(fwLocal, fw);
    fw.addScaled(n, -fw.dot(n));
    if (fw.lengthSq() < 1e-6) return; // wheel axis ~ parallel to normal; no tire force
    fw.normalize();
    right.crossOf(fw, n);

    body.velocityAt(this.hit.point, vContact);
    const vLong = vContact.dot(fw);
    const vLat = vContact.dot(right);

    const surf = SURFACES[this.surface];
    const mu = surf.friction * this.vehicle.tires.grip;
    const handbraked = ctx.handbrake && this.cfg.handbraked;
    const muLat = mu * (handbraked ? this.vehicle.brakes.handbrakeGrip : 1);

    // --- Longitudinal: drive minus braking/rolling resistance. Resistive
    // forces are clamped so they can stop the wheel's mass share within one
    // step but never push it backwards (kills low-speed jitter).
    let longF = ctx.drive;
    let resist = ctx.brake + surf.rollingResistance * springForce;
    if (handbraked) resist += this.vehicle.brakes.handbrakeForce;
    const killLong = (Math.abs(vLong) * ctx.shareMass) / dt;
    longF -= Math.sign(vLong) * Math.min(resist, killLong);

    // --- Lateral: linear response in slip velocity, same kill clamp.
    let latF = -vLat * this.vehicle.tires.corneringResponse * springForce;
    const killLat = (Math.abs(vLat) * ctx.shareMass) / dt;
    latF = clamp(latF, -killLat, killLat);

    // --- Friction ellipse: combined demand beyond grip means sliding.
    const maxLong = mu * springForce;
    const maxLat = muLat * springForce;
    let slipRatio = 0;
    if (maxLong > 1e-6 && maxLat > 1e-6) {
      slipRatio = Math.hypot(longF / maxLong, latF / maxLat);
      if (slipRatio > 1) {
        longF /= slipRatio;
        latF /= slipRatio;
      }
    } else {
      longF = 0;
      latF = 0;
    }
    this.sliding = slipRatio > 1.02 && (Math.abs(vLat) > 0.8 || Math.abs(ctx.drive) > maxLong);

    force.set(0, 0, 0).addScaled(fw, longF).addScaled(right, latF);
    body.applyForce(force, this.hit.point);

    // --- Surface drag (water, mud): resists the contact point velocity.
    if (surf.drag > 0) {
      let factor = 1;
      if (this.surface === 'water') {
        factor = clamp((WORLD.waterLevel - this.hit.point.y) / 0.8, 0.2, 1.6);
      }
      force.copy(vContact).scale(-surf.drag * factor);
      body.applyForce(force, this.hit.point);
    }

    // --- Visual spin: rolls with ground speed; locks under handbrake.
    this.spinVel = handbraked ? 0 : vLong / this.cfg.radius;
    if (this.sliding && Math.abs(ctx.drive) > maxLong) {
      this.spinVel += Math.sign(ctx.drive) * 8;
    }
    this.advanceSpin(dt);
  }

  private advanceSpin(dt: number): void {
    this.spinAngle += this.spinVel * dt;
    // Keep bounded; the renderer interpolates angles along the shortest path.
    if (this.spinAngle > Math.PI) this.spinAngle -= TWO_PI;
    else if (this.spinAngle < -Math.PI) this.spinAngle += TWO_PI;
  }
}

const offsetVec = new Vec3();
function toVec(o: { x: number; y: number; z: number }): Vec3 {
  return offsetVec.set(o.x, o.y, o.z);
}
