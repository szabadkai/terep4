/**
 * SimWorld: top of the simulation layer. Steps the vehicle at a fixed dt,
 * handles resets, and maintains previous/current snapshots for the renderer
 * to interpolate between. Knows nothing about rendering or input devices
 * beyond the plain InputState contract.
 */

import { SIM, BUGGY } from '../config';
import type { InputState } from '../input/input';
import type { Terrain } from '../terrain/terrain';
import { Vehicle } from './vehicle';
import { type VehicleSnapshot, makeSnapshot, fillSnapshot, copySnapshot } from './snapshot';

export class SimWorld {
  readonly vehicle: Vehicle;
  readonly prev: VehicleSnapshot;
  readonly curr: VehicleSnapshot;

  /** Set by input for one tick; consumed here. */
  resetRequested = false;

  constructor(readonly terrain: Terrain) {
    this.vehicle = new Vehicle(BUGGY, terrain);
    this.prev = makeSnapshot(this.vehicle.wheels.length);
    this.curr = makeSnapshot(this.vehicle.wheels.length);
    fillSnapshot(this.vehicle, this.curr);
    copySnapshot(this.curr, this.prev);
  }

  step(input: InputState, dt: number): void {
    if (this.resetRequested) {
      this.resetRequested = false;
      const { pos } = this.vehicle.body;
      this.vehicle.reset(pos.x, pos.z, this.vehicle.yaw());
    }
    if (this.vehicle.body.pos.y < SIM.killHeight) {
      this.vehicle.reset(0, 0, 0);
    }

    copySnapshot(this.curr, this.prev);
    this.vehicle.step(input, dt);
    fillSnapshot(this.vehicle, this.curr);
  }
}
