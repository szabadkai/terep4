/**
 * Temporary tire tracks: small ground-aligned strips emitted from grounded
 * wheels. Uses a fixed mesh pool and fades by shrinking each mark over time.
 */

import * as THREE from 'three';
import { BUGGY, type SurfaceId } from '../config';
import type { VehicleSnapshot } from '../sim/snapshot';
import type { Terrain } from '../terrain/terrain';
import type { VehicleView } from './vehicleView';

const MAX_TRACKS = 900;
const VEHICLE_WHEELS = BUGGY.wheels.length;
const TRACK_LIFE = 8.5;
const MIN_SPEED = 2.0;
const MIN_SEGMENT = 0.55;
const MAX_SEGMENT = 2.4;
const SURFACE_LIFT = 0.055;
const HIDE_Y = -10000;
const UP = new THREE.Vector3(0, 1, 0);

interface TrackProfile {
  color: number;
  opacity: number;
  width: number;
  minSlip: boolean;
}

const TRACK_PROFILES: Record<SurfaceId, TrackProfile | null> = {
  grass: { color: 0x526d3d, opacity: 0.2, width: 0.22, minSlip: false },
  rock: { color: 0x5f5a52, opacity: 0.2, width: 0.24, minSlip: true },
  mud: { color: 0x332116, opacity: 0.5, width: 0.34, minSlip: false },
  sand: { color: 0xaa8d55, opacity: 0.36, width: 0.3, minSlip: false },
  snow: { color: 0xb9cbd5, opacity: 0.48, width: 0.32, minSlip: false },
  water: null,
};

interface WheelTrail {
  hasLast: boolean;
  last: THREE.Vector3;
  distance: number;
}

export class TireTracks {
  private readonly geometry = new THREE.BufferGeometry();
  private readonly positions = new Float32Array(MAX_TRACKS * 4 * 3);
  private readonly colors = new Float32Array(MAX_TRACKS * 4 * 3);
  private readonly indices = new Uint32Array(MAX_TRACKS * 6);
  private readonly positionAttr = new THREE.BufferAttribute(this.positions, 3);
  private readonly colorAttr = new THREE.BufferAttribute(this.colors, 3);
  private readonly material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    side: THREE.DoubleSide,
  });
  private readonly mesh: THREE.Mesh;
  private readonly centers: THREE.Vector3[] = [];
  private readonly forwardDirs: THREE.Vector3[] = [];
  private readonly sideDirs: THREE.Vector3[] = [];
  private readonly lengths = new Float32Array(MAX_TRACKS);
  private readonly widths = new Float32Array(MAX_TRACKS);
  private readonly life = new Float32Array(MAX_TRACKS);
  private readonly baseColors = new Float32Array(MAX_TRACKS * 3);
  private readonly trails: WheelTrail[] = [];
  private readonly contact = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly color = new THREE.Color();

  private cursor = 0;
  private liveCount = 0;

  constructor(
    scene: THREE.Scene,
    private readonly terrain: Terrain,
  ) {
    for (let i = 0; i < MAX_TRACKS; i++) {
      const v = i * 4;
      const q = i * 6;
      this.indices[q] = v;
      this.indices[q + 1] = v + 1;
      this.indices[q + 2] = v + 2;
      this.indices[q + 3] = v;
      this.indices[q + 4] = v + 2;
      this.indices[q + 5] = v + 3;
      this.centers.push(new THREE.Vector3(0, HIDE_Y, 0));
      this.forwardDirs.push(new THREE.Vector3(0, 0, 1));
      this.sideDirs.push(new THREE.Vector3(1, 0, 0));
      this.hideTrack(i);
    }
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.positionAttr);
    this.geometry.setAttribute('color', this.colorAttr);
    this.geometry.setIndex(new THREE.BufferAttribute(this.indices, 1));

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(dt: number): void {
    this.liveCount = 0;
    for (let i = 0; i < MAX_TRACKS; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] = Math.max(0, this.life[i] - dt);
      if (this.life[i] <= 0) {
        this.hideTrack(i);
        continue;
      }
      this.writeTrack(i);
      this.liveCount++;
    }
    this.positionAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
  }

  emitVehicle(index: number, view: VehicleView, snap: VehicleSnapshot): void {
    const speed = snap.speedKmh / 3.6;
    if (speed < MIN_SPEED) {
      this.resetVehicleTrails(index);
      return;
    }

    view.group.getWorldDirection(this.forward);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, 1);
    this.forward.normalize();
    this.side.crossVectors(UP, this.forward).normalize();

    for (let wheelIndex = 0; wheelIndex < snap.wheels.length; wheelIndex++) {
      const wheel = snap.wheels[wheelIndex];
      const profile = TRACK_PROFILES[wheel.surface];
      const trail = this.trailFor(index, wheelIndex);
      if (
        !wheel.grounded ||
        profile === null ||
        (profile.minSlip && !wheel.sliding && !snap.sliding)
      ) {
        trail.hasLast = false;
        trail.distance = 0;
        continue;
      }

      this.wheelContact(view, snap, wheelIndex, this.contact);
      if (!trail.hasLast) {
        trail.last.copy(this.contact);
        trail.hasLast = true;
        trail.distance = 0;
        continue;
      }

      const moved = this.contact.distanceTo(trail.last);
      trail.distance += moved;
      const stride = wheel.sliding || snap.sliding ? MIN_SEGMENT : MIN_SEGMENT * 1.55;
      if (trail.distance >= stride) {
        const length = Math.min(MAX_SEGMENT, Math.max(MIN_SEGMENT, trail.distance));
        const intensity = wheel.sliding || snap.sliding ? 1 : 0.72;
        this.addTrack(profile, trail.last, this.contact, length, intensity);
        trail.distance = 0;
      }
      trail.last.copy(this.contact);
    }
  }

  get count(): number {
    return this.liveCount;
  }

  private trailFor(vehicleIndex: number, wheelIndex: number): WheelTrail {
    const index = vehicleIndex * VEHICLE_WHEELS + wheelIndex;
    let trail = this.trails[index];
    if (!trail) {
      trail = { hasLast: false, last: new THREE.Vector3(), distance: 0 };
      this.trails[index] = trail;
    }
    return trail;
  }

  private resetVehicleTrails(vehicleIndex: number): void {
    for (let i = 0; i < VEHICLE_WHEELS; i++) {
      const trail = this.trails[vehicleIndex * VEHICLE_WHEELS + i];
      if (trail) {
        trail.hasLast = false;
        trail.distance = 0;
      }
    }
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
    out.y = this.terrain.height(out.x, out.z) + SURFACE_LIFT;
  }

  private addTrack(
    profile: TrackProfile,
    from: THREE.Vector3,
    to: THREE.Vector3,
    length: number,
    intensity: number,
  ): void {
    const index = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_TRACKS;

    const forward = this.forwardDirs[index];
    forward.subVectors(to, from);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.copy(this.forward);
    forward.normalize();

    const side = this.sideDirs[index];
    side.crossVectors(UP, forward).normalize();
    this.centers[index].copy(from).add(to).multiplyScalar(0.5);
    this.centers[index].y =
      this.terrain.height(this.centers[index].x, this.centers[index].z) + SURFACE_LIFT;
    this.lengths[index] = length;
    this.widths[index] = profile.width;
    this.life[index] = TRACK_LIFE * (0.75 + profile.opacity * 0.5);

    this.color.setHex(profile.color);
    const brightness = profile.opacity * intensity;
    const c = index * 3;
    this.baseColors[c] = this.color.r * brightness;
    this.baseColors[c + 1] = this.color.g * brightness;
    this.baseColors[c + 2] = this.color.b * brightness;
    this.writeTrack(index);
  }

  private writeTrack(index: number): void {
    const fade = Math.max(0, this.life[index] / TRACK_LIFE);
    const shrink = 0.62 + fade * 0.38;
    const halfLen = this.lengths[index] * 0.5 * shrink;
    const halfWidth = this.widths[index] * 0.5 * shrink;
    const center = this.centers[index];
    const forward = this.forwardDirs[index];
    const side = this.sideDirs[index];
    const corners = [
      [-halfLen, -halfWidth],
      [halfLen, -halfWidth],
      [halfLen, halfWidth],
      [-halfLen, halfWidth],
    ];
    const vertex = index * 4 * 3;
    for (let i = 0; i < 4; i++) {
      const p = vertex + i * 3;
      const [f, s] = corners[i];
      this.positions[p] = center.x + forward.x * f + side.x * s;
      this.positions[p + 1] = center.y;
      this.positions[p + 2] = center.z + forward.z * f + side.z * s;

      const c = index * 3;
      this.colors[p] = this.baseColors[c] * fade;
      this.colors[p + 1] = this.baseColors[c + 1] * fade;
      this.colors[p + 2] = this.baseColors[c + 2] * fade;
    }
  }

  private hideTrack(index: number): void {
    const vertex = index * 4 * 3;
    for (let i = 0; i < 4; i++) {
      const p = vertex + i * 3;
      this.positions[p] = 0;
      this.positions[p + 1] = HIDE_Y;
      this.positions[p + 2] = 0;
      this.colors[p] = 0;
      this.colors[p + 1] = 0;
      this.colors[p + 2] = 0;
    }
  }
}
