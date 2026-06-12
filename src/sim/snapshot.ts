/**
 * Plain-data snapshots of sim state. This is the only thing the render
 * layer reads — no Three.js types here, no live sim objects there.
 */

import type { SurfaceId } from '../config';
import type { Vehicle } from './vehicle';

export interface WheelSnapshot {
  steer: number;
  spin: number;
  suspLen: number;
  grounded: boolean;
  sliding: boolean;
  surface: SurfaceId;
}

export interface VehicleSnapshot {
  pos: { x: number; y: number; z: number };
  quat: { x: number; y: number; z: number; w: number };
  wheels: WheelSnapshot[];
  speedKmh: number;
  /** Surface under the majority of grounded wheels, or null if airborne. */
  surface: SurfaceId | null;
  sliding: boolean;
}

export function makeSnapshot(wheelCount: number): VehicleSnapshot {
  return {
    pos: { x: 0, y: 0, z: 0 },
    quat: { x: 0, y: 0, z: 0, w: 1 },
    wheels: Array.from({ length: wheelCount }, () => ({
      steer: 0,
      spin: 0,
      suspLen: 0,
      grounded: false,
      sliding: false,
      surface: 'grass' as SurfaceId,
    })),
    speedKmh: 0,
    surface: null,
    sliding: false,
  };
}

export function fillSnapshot(vehicle: Vehicle, out: VehicleSnapshot): void {
  const { body } = vehicle;
  out.pos.x = body.pos.x;
  out.pos.y = body.pos.y;
  out.pos.z = body.pos.z;
  out.quat.x = body.quat.x;
  out.quat.y = body.quat.y;
  out.quat.z = body.quat.z;
  out.quat.w = body.quat.w;
  out.speedKmh = body.vel.length() * 3.6;

  const counts = new Map<SurfaceId, number>();
  out.sliding = false;
  for (let i = 0; i < vehicle.wheels.length; i++) {
    const w = vehicle.wheels[i];
    const ws = out.wheels[i];
    ws.steer = w.steer;
    ws.spin = w.spinAngle;
    ws.suspLen = w.suspLen;
    ws.grounded = w.grounded;
    ws.sliding = w.sliding;
    ws.surface = w.surface;
    if (w.grounded) counts.set(w.surface, (counts.get(w.surface) ?? 0) + 1);
    if (w.sliding) out.sliding = true;
  }

  out.surface = null;
  let best = 0;
  for (const [surface, count] of counts) {
    if (count > best) {
      best = count;
      out.surface = surface;
    }
  }
}

export function copySnapshot(from: VehicleSnapshot, to: VehicleSnapshot): void {
  Object.assign(to.pos, from.pos);
  Object.assign(to.quat, from.quat);
  to.speedKmh = from.speedKmh;
  to.surface = from.surface;
  to.sliding = from.sliding;
  for (let i = 0; i < from.wheels.length; i++) Object.assign(to.wheels[i], from.wheels[i]);
}
