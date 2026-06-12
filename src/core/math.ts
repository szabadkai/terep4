/**
 * Minimal 3D math for the simulation layer. The sim must not depend on
 * Three.js, so it gets its own vectors and quaternions. Conventions match
 * Three.js (right-handed, +Y up, quaternion xyzw) so snapshots translate 1:1.
 */

export class Vec3 {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
  ) {}

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(v: Vec3): this {
    return this.set(v.x, v.y, v.z);
  }

  clone(): Vec3 {
    return new Vec3(this.x, this.y, this.z);
  }

  add(v: Vec3): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  sub(v: Vec3): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  scale(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  addScaled(v: Vec3, s: number): this {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    return this;
  }

  dot(v: Vec3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  /** this = a × b */
  crossOf(a: Vec3, b: Vec3): this {
    const x = a.y * b.z - a.z * b.y;
    const y = a.z * b.x - a.x * b.z;
    const z = a.x * b.y - a.y * b.x;
    return this.set(x, y, z);
  }

  lengthSq(): number {
    return this.dot(this);
  }

  length(): number {
    return Math.sqrt(this.lengthSq());
  }

  normalize(): this {
    const len = this.length();
    return len > 1e-12 ? this.scale(1 / len) : this.set(0, 0, 0);
  }
}

export class Quat {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
    public w = 1,
  ) {}

  set(x: number, y: number, z: number, w: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    return this;
  }

  copy(q: Quat): this {
    return this.set(q.x, q.y, q.z, q.w);
  }

  identity(): this {
    return this.set(0, 0, 0, 1);
  }

  setAxisAngle(axis: Vec3, angle: number): this {
    const half = angle / 2;
    const s = Math.sin(half);
    return this.set(axis.x * s, axis.y * s, axis.z * s, Math.cos(half));
  }

  normalize(): this {
    const len = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);
    if (len < 1e-12) return this.identity();
    const inv = 1 / len;
    this.x *= inv;
    this.y *= inv;
    this.z *= inv;
    this.w *= inv;
    return this;
  }

  /** Rotate vector v in place by this quaternion. */
  rotate(v: Vec3): Vec3 {
    // v' = v + 2w(q × v) + 2(q × (q × v))
    const tx = 2 * (this.y * v.z - this.z * v.y);
    const ty = 2 * (this.z * v.x - this.x * v.z);
    const tz = 2 * (this.x * v.y - this.y * v.x);
    v.x += this.w * tx + this.y * tz - this.z * ty;
    v.y += this.w * ty + this.z * tx - this.x * tz;
    v.z += this.w * tz + this.x * ty - this.y * tx;
    return v;
  }

  /** Rotate vector v in place by the inverse of this (unit) quaternion. */
  rotateInverse(v: Vec3): Vec3 {
    const tx = 2 * (-this.y * v.z + this.z * v.y);
    const ty = 2 * (-this.z * v.x + this.x * v.z);
    const tz = 2 * (-this.x * v.y + this.y * v.x);
    v.x += this.w * tx - this.y * tz + this.z * ty;
    v.y += this.w * ty - this.z * tx + this.x * tz;
    v.z += this.w * tz - this.x * ty + this.y * tx;
    return v;
  }

  /** Integrate angular velocity (world frame, rad/s) over dt: q += 0.5·dt·(ω ⊗ q). */
  integrate(angVel: Vec3, dt: number): this {
    const hx = angVel.x * dt * 0.5;
    const hy = angVel.y * dt * 0.5;
    const hz = angVel.z * dt * 0.5;
    const { x, y, z, w } = this;
    this.x += hx * w + hy * z - hz * y;
    this.y += hy * w + hz * x - hx * z;
    this.z += hz * w + hx * y - hy * x;
    this.w += -hx * x - hy * y - hz * z;
    return this.normalize();
  }
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
