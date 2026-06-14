/**
 * Lightweight wheel-contact particles. This is render-only feedback driven by
 * vehicle snapshots, with a fixed pool so heavy sliding does not allocate.
 */

import * as THREE from 'three';
import { BUGGY, WORLD, type SurfaceId } from '../config';
import type { VehicleSnapshot } from '../sim/snapshot';
import type { Terrain } from '../terrain/terrain';
import type { VehicleView } from './vehicleView';

const MAX_PARTICLES = 1000;
const MAX_EMIT_PER_WHEEL = 6;
const HIDE_Y = -10000;
const UP = new THREE.Vector3(0, 1, 0);

interface SurfaceParticleProfile {
  color: number;
  baseRate: number;
  speedRate: number;
  slipBoost: number;
  lifeMin: number;
  lifeMax: number;
  backSpeed: number;
  sideSpeed: number;
  upSpeed: number;
  gravity: number;
  drag: number;
  height: number;
}

const PROFILES: Record<SurfaceId, SurfaceParticleProfile> = {
  grass: {
    color: 0xb9a26e,
    baseRate: 0.5,
    speedRate: 0.45,
    slipBoost: 10,
    lifeMin: 0.45,
    lifeMax: 0.8,
    backSpeed: 0.24,
    sideSpeed: 1.4,
    upSpeed: 0.9,
    gravity: 1.5,
    drag: 1.8,
    height: 0.12,
  },
  rock: {
    color: 0xa9a098,
    baseRate: 0.3,
    speedRate: 0.28,
    slipBoost: 7,
    lifeMin: 0.34,
    lifeMax: 0.62,
    backSpeed: 0.18,
    sideSpeed: 1.0,
    upSpeed: 0.65,
    gravity: 1.8,
    drag: 2.1,
    height: 0.1,
  },
  mud: {
    color: 0x5a3a22,
    baseRate: 1.6,
    speedRate: 0.75,
    slipBoost: 18,
    lifeMin: 0.55,
    lifeMax: 1.05,
    backSpeed: 0.16,
    sideSpeed: 1.9,
    upSpeed: 1.5,
    gravity: 3.6,
    drag: 1.4,
    height: 0.16,
  },
  sand: {
    color: 0xd7c07d,
    baseRate: 1.1,
    speedRate: 0.65,
    slipBoost: 13,
    lifeMin: 0.5,
    lifeMax: 0.95,
    backSpeed: 0.22,
    sideSpeed: 1.6,
    upSpeed: 1.0,
    gravity: 1.6,
    drag: 1.7,
    height: 0.13,
  },
  snow: {
    color: 0xe8f2f8,
    baseRate: 1.4,
    speedRate: 0.58,
    slipBoost: 15,
    lifeMin: 0.65,
    lifeMax: 1.15,
    backSpeed: 0.2,
    sideSpeed: 1.8,
    upSpeed: 1.35,
    gravity: 1.0,
    drag: 1.4,
    height: 0.16,
  },
  water: {
    color: 0x9fd8f2,
    baseRate: 2.4,
    speedRate: 0.95,
    slipBoost: 16,
    lifeMin: 0.35,
    lifeMax: 0.75,
    backSpeed: 0.12,
    sideSpeed: 2.3,
    upSpeed: 2.4,
    gravity: 5.2,
    drag: 2.4,
    height: 0.08,
  },
};

export class WheelParticles {
  private readonly geometry = new THREE.BufferGeometry();
  private readonly positions = new Float32Array(MAX_PARTICLES * 3);
  private readonly colors = new Float32Array(MAX_PARTICLES * 3);
  private readonly positionAttr = new THREE.BufferAttribute(this.positions, 3);
  private readonly colorAttr = new THREE.BufferAttribute(this.colors, 3);
  private readonly material = new THREE.PointsMaterial({
    size: 0.48,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.86,
    depthWrite: false,
  });
  private readonly points: THREE.Points;
  private readonly baseColors = new Float32Array(MAX_PARTICLES * 3);
  private readonly velocities = new Float32Array(MAX_PARTICLES * 3);
  private readonly life = new Float32Array(MAX_PARTICLES);
  private readonly maxLife = new Float32Array(MAX_PARTICLES);
  private readonly gravity = new Float32Array(MAX_PARTICLES);
  private readonly drag = new Float32Array(MAX_PARTICLES);
  private readonly emitAccumulators: number[] = [];
  private readonly color = new THREE.Color();
  private readonly wheelPos = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly side = new THREE.Vector3();

  private cursor = 0;
  private liveCount = 0;

  constructor(
    scene: THREE.Scene,
    private readonly terrain: Terrain,
  ) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.positions[i * 3 + 1] = HIDE_Y;
    }
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.positionAttr);
    this.geometry.setAttribute('color', this.colorAttr);
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(dt: number): void {
    this.liveCount = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] <= 0) continue;

      this.life[i] = Math.max(0, this.life[i] - dt);
      const p = i * 3;
      if (this.life[i] <= 0) {
        this.positions[p + 1] = HIDE_Y;
        continue;
      }

      const damping = Math.max(0, 1 - this.drag[i] * dt);
      this.velocities[p] *= damping;
      this.velocities[p + 1] = this.velocities[p + 1] * damping - this.gravity[i] * dt;
      this.velocities[p + 2] *= damping;
      this.positions[p] += this.velocities[p] * dt;
      this.positions[p + 1] += this.velocities[p + 1] * dt;
      this.positions[p + 2] += this.velocities[p + 2] * dt;

      const fade = this.life[i] / this.maxLife[i];
      this.colors[p] = this.baseColors[p] * fade;
      this.colors[p + 1] = this.baseColors[p + 1] * fade;
      this.colors[p + 2] = this.baseColors[p + 2] * fade;
      this.liveCount++;
    }
    this.positionAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
  }

  emitVehicle(index: number, view: VehicleView, snap: VehicleSnapshot, dt: number): void {
    const speed = snap.speedKmh / 3.6;
    if (speed < 1.2) return;

    view.group.getWorldDirection(this.forward);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, 1);
    this.forward.normalize();
    this.side.crossVectors(UP, this.forward).normalize();

    for (let wheelIndex = 0; wheelIndex < snap.wheels.length; wheelIndex++) {
      const wheel = snap.wheels[wheelIndex];
      if (!wheel.grounded) continue;

      const profile = PROFILES[wheel.surface];
      const slip = wheel.sliding || snap.sliding ? 1 : 0;
      const rate =
        profile.baseRate + Math.max(0, speed - 2) * profile.speedRate + slip * profile.slipBoost;
      const accumulatorIndex = index * BUGGY.wheels.length + wheelIndex;
      const accumulated = (this.emitAccumulators[accumulatorIndex] ?? 0) + rate * dt;
      const count = Math.min(MAX_EMIT_PER_WHEEL, Math.floor(accumulated));
      this.emitAccumulators[accumulatorIndex] = accumulated - count;
      if (count <= 0) continue;

      this.wheelContact(view, snap, wheelIndex, this.wheelPos);
      for (let i = 0; i < count; i++) {
        this.emitParticle(profile, speed, slip, this.wheelPos);
      }
    }
  }

  get count(): number {
    return this.liveCount;
  }

  private wheelContact(
    view: VehicleView,
    snap: VehicleSnapshot,
    wheelIndex: number,
    out: THREE.Vector3,
  ): void {
    const cfg = BUGGY.wheels[wheelIndex];
    const wheel = snap.wheels[wheelIndex];
    out.set(cfg.offset.x, cfg.offset.y - wheel.suspLen - cfg.radius * 0.82, cfg.offset.z);
    view.group.localToWorld(out);
    const groundY =
      wheel.surface === 'water' ? WORLD.waterLevel + 0.04 : this.terrain.height(out.x, out.z);
    out.y = groundY + PROFILES[wheel.surface].height;
  }

  private emitParticle(
    profile: SurfaceParticleProfile,
    speed: number,
    slip: number,
    origin: THREE.Vector3,
  ): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_PARTICLES;

    const p = i * 3;
    const lateral = (Math.random() - 0.5) * profile.sideSpeed * (0.9 + slip * 0.6);
    const back = profile.backSpeed * speed * (0.45 + Math.random() * 0.7);
    const upward = profile.upSpeed * (0.45 + Math.random() * 0.9) * (0.75 + slip * 0.55);

    this.positions[p] = origin.x + (Math.random() - 0.5) * 0.35;
    this.positions[p + 1] = origin.y;
    this.positions[p + 2] = origin.z + (Math.random() - 0.5) * 0.35;
    this.velocities[p] = -this.forward.x * back + this.side.x * lateral;
    this.velocities[p + 1] = upward;
    this.velocities[p + 2] = -this.forward.z * back + this.side.z * lateral;

    const life = profile.lifeMin + Math.random() * (profile.lifeMax - profile.lifeMin);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.gravity[i] = profile.gravity;
    this.drag[i] = profile.drag;

    this.color.setHex(profile.color);
    const brightness = 0.75 + Math.random() * 0.35;
    this.baseColors[p] = this.color.r * brightness;
    this.baseColors[p + 1] = this.color.g * brightness;
    this.baseColors[p + 2] = this.color.b * brightness;
    this.colors[p] = this.baseColors[p];
    this.colors[p + 1] = this.baseColors[p + 1];
    this.colors[p + 2] = this.baseColors[p + 2];
  }
}
