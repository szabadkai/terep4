/**
 * SimWorld: top of the simulation layer. Steps the player vehicle, the AI
 * racers and the race at a fixed dt, handles resets, computes standings, and
 * maintains previous/current snapshots for the renderer to interpolate
 * between. Knows nothing about rendering or input devices beyond the plain
 * InputState contract.
 */

import { SIM, WORLD, BUGGY, OPPONENTS } from '../config';
import type { InputState } from '../input/input';
import type { Terrain } from '../terrain/terrain';
import { Vehicle } from './vehicle';
import { Racer } from './racer';
import { Race, type RaceState, type Standing } from './race';
import { type VehicleSnapshot, makeSnapshot, fillSnapshot, copySnapshot } from './snapshot';

const NEUTRAL_INPUT: InputState = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  reset: false,
};

/** Render-facing snapshot pair for one entrant. */
export interface RacerView {
  spec: { name: string; color: number };
  prev: VehicleSnapshot;
  curr: VehicleSnapshot;
}

export class SimWorld {
  readonly vehicle: Vehicle;
  readonly race: Race;
  readonly racers: Racer[];
  readonly racerViews: RacerView[];
  readonly prev: VehicleSnapshot;
  readonly curr: VehicleSnapshot;
  readonly raceState: RaceState = {
    phase: 'ready',
    current: 0,
    count: 0,
    elapsed: 0,
    countdownRemaining: 0,
    finishTime: null,
    next: null,
    position: 1,
    total: 1,
    standings: [],
  };

  /** Set by input for one tick; consumed here. */
  resetRequested = false;

  constructor(readonly terrain: Terrain) {
    this.vehicle = new Vehicle(BUGGY, terrain);
    this.race = new Race(terrain, WORLD.seed);
    this.racers = OPPONENTS.map((spec) => new Racer(spec, terrain, this.race.checkpoints));
    this.racerViews = this.racers.map((r) => ({
      spec: { name: r.spec.name, color: r.spec.color },
      prev: makeSnapshot(r.vehicle.wheels.length),
      curr: makeSnapshot(r.vehicle.wheels.length),
    }));

    // Settle everyone onto the suspension so they rest naturally at the start.
    for (const r of this.racers) r.reset();
    for (let i = 0; i < 90; i++) {
      this.vehicle.step(NEUTRAL_INPUT, SIM.dt);
      for (const r of this.racers) r.step(SIM.dt, false, 0);
    }

    this.prev = makeSnapshot(this.vehicle.wheels.length);
    this.curr = makeSnapshot(this.vehicle.wheels.length);
    fillSnapshot(this.vehicle, this.curr);
    copySnapshot(this.curr, this.prev);
    for (const v of this.racerViews) {
      const i = this.racerViews.indexOf(v);
      fillSnapshot(this.racers[i].vehicle, v.curr);
      copySnapshot(v.curr, v.prev);
    }
    this.race.fillState(this.raceState);
    this.updateStandings();
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

    const raceWasRunning = this.race.phase === 'running';
    const effectiveInput = raceWasRunning ? input : NEUTRAL_INPUT;

    copySnapshot(this.curr, this.prev);
    this.vehicle.step(effectiveInput, dt);
    fillSnapshot(this.vehicle, this.curr);

    // The race object owns countdown and elapsed-time transitions.
    const { pos } = this.vehicle.body;
    this.race.step(dt, pos.x, pos.z);
    this.race.fillState(this.raceState);

    // AI opponents race on the same fixed tick as the player after countdown.
    const running = raceWasRunning;
    for (let i = 0; i < this.racers.length; i++) {
      const view = this.racerViews[i];
      copySnapshot(view.curr, view.prev);
      this.racers[i].step(dt, running, this.race.elapsed);
      fillSnapshot(this.racers[i].vehicle, view.curr);
    }

    this.updateStandings();
  }

  /** New race: clock, checkpoints and all cars back on the start pad. */
  restartRace(): void {
    this.race.restart();
    this.vehicle.reset(0, 0, 0);
    fillSnapshot(this.vehicle, this.curr);
    copySnapshot(this.curr, this.prev);
    for (let i = 0; i < this.racers.length; i++) {
      this.racers[i].reset();
      fillSnapshot(this.racers[i].vehicle, this.racerViews[i].curr);
      copySnapshot(this.racerViews[i].curr, this.racerViews[i].prev);
    }
    this.race.fillState(this.raceState);
    this.updateStandings();
  }

  startCountdown(): void {
    this.race.startCountdown();
    this.race.fillState(this.raceState);
    this.updateStandings();
  }

  /** Rank player + AI by finished/time, then checkpoint progress, then how
   * close they are to their next checkpoint (finer ordering between gates). */
  private updateStandings(): void {
    const checkpoints = this.race.checkpoints;
    const distToNext = (progress: number, x: number, z: number): number => {
      const cp = checkpoints[Math.min(progress, checkpoints.length - 1)];
      return Math.hypot(x - cp.x, z - cp.z);
    };

    const playerPos = this.vehicle.body.pos;
    const entries: Array<Standing & { rank: number }> = [
      {
        name: 'You',
        color: null,
        progress: this.race.current,
        finished: this.race.phase === 'finished',
        time: this.race.finishTime,
        isPlayer: true,
        rank: distToNext(this.race.current, playerPos.x, playerPos.z),
      },
      ...this.racers.map((r) => ({
        name: r.spec.name,
        color: r.spec.color,
        progress: r.current,
        finished: r.finished,
        time: r.finishTime,
        isPlayer: false,
        rank: distToNext(r.current, r.vehicle.body.pos.x, r.vehicle.body.pos.z),
      })),
    ];

    entries.sort((a, b) => {
      if (a.finished && b.finished) return (a.time ?? 0) - (b.time ?? 0);
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.progress !== b.progress) return b.progress - a.progress;
      return a.rank - b.rank; // closer to the next checkpoint = ahead
    });

    this.raceState.standings = entries.map(({ rank: _rank, ...s }) => s);
    this.raceState.total = entries.length;
    this.raceState.position = this.raceState.standings.findIndex((e) => e.isPlayer) + 1;
  }
}
