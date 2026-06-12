/**
 * Raycast vehicle: a chassis rigid body plus N wheels. Owns drivetrain
 * logic (throttle/brake/reverse/steering) and chassis-vs-terrain contact
 * for crashes and rollovers. All tuning comes from VehicleConfig.
 */

import { Vec3, clamp } from '../core/math';
import { SIM, type VehicleConfig } from '../config';
import type { InputState } from '../input/input';
import type { Terrain } from '../terrain/terrain';
import { RigidBody, boxInertia } from './rigidbody';
import { Wheel } from './wheel';

const Y_AXIS = new Vec3(0, 1, 0);
const localForward = new Vec3(0, 0, 1);
const forward = new Vec3();
const tmp = new Vec3();
const point = new Vec3();
const pointVel = new Vec3();
const normal = new Vec3();
const contactForce = new Vec3();

export class Vehicle {
  readonly body: RigidBody;
  readonly wheels: Wheel[];
  steerAngle = 0;

  private readonly contactPoints: Vec3[];
  private readonly drivenCount: number;

  constructor(
    readonly cfg: VehicleConfig,
    private readonly terrain: Terrain,
  ) {
    const { width, height, length } = cfg.chassis;
    this.body = new RigidBody(
      cfg.mass,
      boxInertia(cfg.mass, width, height, length, cfg.inertiaScale),
    );
    this.wheels = cfg.wheels.map((w) => new Wheel(w, cfg));
    this.drivenCount = Math.max(1, cfg.wheels.filter((w) => w.driven).length);
    this.contactPoints = boxCorners(width, height, length, cfg.chassis.centerY);
    this.reset(0, 0, 0);
  }

  /** Place the vehicle upright at (x, z) with the given yaw, at rest. */
  reset(x: number, z: number, yaw: number): void {
    const groundY = this.terrain.height(x, z);
    const ride = this.cfg.suspension.restLength + this.cfg.wheels[0].radius;
    this.body.pos.set(x, groundY + ride + 0.4, z);
    this.body.vel.set(0, 0, 0);
    this.body.angVel.set(0, 0, 0);
    this.body.quat.setAxisAngle(Y_AXIS, yaw);
    this.steerAngle = 0;
    for (const w of this.wheels) w.rest();
  }

  /** Current yaw, for resetting in place while keeping heading. */
  yaw(): number {
    this.body.localDirToWorld(localForward, forward);
    return Math.atan2(forward.x, forward.z);
  }

  forwardSpeed(): number {
    this.body.localDirToWorld(localForward, forward);
    return this.body.vel.dot(forward);
  }

  step(input: InputState, dt: number): void {
    const { body, cfg } = this;
    const vForward = this.forwardSpeed();

    this.updateSteering(input, vForward, dt);

    // --- Drivetrain: throttle drives forward; brake reverses when stopped.
    let driveTotal = 0;
    let brakePedal = input.brake;
    if (input.brake > 0 && vForward < 0.5) {
      const falloff = Math.max(0, 1 - Math.max(0, -vForward) / cfg.engine.maxReverseSpeed);
      driveTotal -= cfg.engine.reverseForce * input.brake * falloff;
      brakePedal = 0;
    }
    driveTotal +=
      input.throttle *
      cfg.engine.maxForce *
      Math.max(0, 1 - Math.max(0, vForward) / cfg.engine.maxSpeed);

    const drivePerWheel = driveTotal / this.drivenCount;
    const shareMass = cfg.mass / this.wheels.length;

    // --- Gravity, wheels, chassis contacts, aero drag.
    body.applyForce(tmp.set(0, -SIM.gravity * cfg.mass, 0));

    for (const wheel of this.wheels) {
      wheel.steer = wheel.cfg.steered ? this.steerAngle : 0;
      wheel.step({
        body,
        terrain: this.terrain,
        dt,
        drive: wheel.cfg.driven ? drivePerWheel : 0,
        brake: brakePedal * cfg.brakes.force,
        handbrake: input.handbrake,
        shareMass,
      });
    }

    this.chassisContacts(dt);

    const speed = body.vel.length();
    if (speed > 1e-3) {
      body.applyForce(tmp.copy(body.vel).scale(-cfg.aero.drag * speed));
    }

    body.integrate(dt, cfg.aero.linearDamping, cfg.aero.angularDamping);
  }

  private updateSteering(input: InputState, vForward: number, dt: number): void {
    const s = this.cfg.steering;
    const maxAngle = s.maxAngle / (1 + Math.abs(vForward) * s.speedFalloff);
    const target = input.steer * maxAngle;
    const maxDelta = s.rate * dt;
    this.steerAngle += clamp(target - this.steerAngle, -maxDelta, maxDelta);
  }

  /**
   * Penalty contacts between the chassis box corners and the terrain.
   * This is what makes crashes, bottoming-out and rollovers behave.
   */
  private chassisContacts(dt: number): void {
    const { body, cfg } = this;
    const col = cfg.collision;
    const shareMass = cfg.mass / this.contactPoints.length;

    for (const local of this.contactPoints) {
      body.localToWorld(local, point);
      const ground = this.terrain.height(point.x, point.z);
      const pen = ground - point.y;
      if (pen <= 0) continue;

      this.terrain.normal(point.x, point.z, normal);
      body.velocityAt(point, pointVel);
      const vn = normal.dot(pointVel);
      const fn = Math.max(0, col.stiffness * pen - col.damping * vn);

      contactForce.copy(normal).scale(fn);
      // Tangential friction, clamped so it can only oppose sliding.
      tmp.copy(pointVel).addScaled(normal, -vn);
      const vt = tmp.length();
      if (vt > 1e-3) {
        const ft = Math.min(col.friction * fn, (vt * shareMass) / dt);
        contactForce.addScaled(tmp.scale(1 / vt), -ft);
      }
      body.applyForce(contactForce, point);
    }
  }
}

function boxCorners(w: number, h: number, l: number, centerY: number): Vec3[] {
  const corners: Vec3[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        corners.push(new Vec3((sx * w) / 2, centerY + (sy * h) / 2, (sz * l) / 2));
      }
    }
  }
  return corners;
}
