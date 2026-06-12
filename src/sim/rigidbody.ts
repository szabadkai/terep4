/**
 * Single rigid body with force/torque accumulation and semi-implicit Euler
 * integration. The body origin is the center of mass. Inertia is a diagonal
 * tensor in body space (box approximation), rotated per-step.
 */

import { Vec3, Quat } from '../core/math';

const tmpA = new Vec3();
const tmpB = new Vec3();

export class RigidBody {
  readonly pos = new Vec3();
  readonly vel = new Vec3();
  readonly quat = new Quat();
  readonly angVel = new Vec3();

  readonly invMass: number;
  /** Inverse of the diagonal body-space inertia tensor. */
  private readonly invInertia = new Vec3();

  private readonly force = new Vec3();
  private readonly torque = new Vec3();

  constructor(
    readonly mass: number,
    inertia: Vec3,
  ) {
    this.invMass = 1 / mass;
    this.invInertia.set(1 / inertia.x, 1 / inertia.y, 1 / inertia.z);
  }

  /** Apply a world-space force at a world-space point (defaults to the COM). */
  applyForce(f: Vec3, at?: Vec3): void {
    this.force.add(f);
    if (at) {
      tmpA.copy(at).sub(this.pos);
      this.torque.add(tmpB.crossOf(tmpA, f));
    }
  }

  applyTorque(t: Vec3): void {
    this.torque.add(t);
  }

  /** Transform a body-space point to world space. */
  localToWorld(local: Vec3, out: Vec3): Vec3 {
    return this.quat.rotate(out.copy(local)).add(this.pos);
  }

  /** Rotate a body-space direction to world space. */
  localDirToWorld(local: Vec3, out: Vec3): Vec3 {
    return this.quat.rotate(out.copy(local));
  }

  /** Velocity of a world-space point attached to the body. */
  velocityAt(point: Vec3, out: Vec3): Vec3 {
    tmpA.copy(point).sub(this.pos);
    return out.crossOf(this.angVel, tmpA).add(this.vel);
  }

  integrate(dt: number, linearDamping: number, angularDamping: number): void {
    this.vel.addScaled(this.force, this.invMass * dt);
    this.vel.scale(1 / (1 + linearDamping * dt));
    this.pos.addScaled(this.vel, dt);

    // Torque world → body, scale by inverse inertia, back to world.
    const acc = tmpA.copy(this.torque);
    this.quat.rotateInverse(acc);
    acc.x *= this.invInertia.x;
    acc.y *= this.invInertia.y;
    acc.z *= this.invInertia.z;
    this.quat.rotate(acc);
    this.angVel.addScaled(acc, dt);
    this.angVel.scale(1 / (1 + angularDamping * dt));
    this.quat.integrate(this.angVel, dt);

    this.force.set(0, 0, 0);
    this.torque.set(0, 0, 0);
  }
}

/** Diagonal inertia of a solid box (full extents), optionally scaled. */
export function boxInertia(mass: number, w: number, h: number, l: number, scale = 1): Vec3 {
  const k = (mass / 12) * scale;
  return new Vec3(k * (h * h + l * l), k * (w * w + l * l), k * (w * w + h * h));
}
