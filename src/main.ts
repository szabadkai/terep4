/**
 * Composition root. Wires input → sim (fixed timestep) → render
 * (interpolated), plus the menu/pause/finish flow. This is the only file
 * that sees all three layers.
 */

import * as THREE from 'three';
import { SIM, WORLD } from './config';
import { FixedLoop } from './core/loop';
import { KeyboardInput } from './input/input';
import { Terrain, NoiseHeightSource } from './terrain/terrain';
import { SimWorld } from './sim/world';
import { createScene } from './render/scene';
import { TerrainView } from './render/terrainView';
import { ScatterView } from './render/scatterView';
import { VehicleView } from './render/vehicleView';
import { CheckpointView } from './render/checkpointView';
import { CameraRig } from './render/cameraRig';
import { Hud } from './render/hud';
import { GameUi } from './render/ui';
import { DebugOverlay } from './render/debugOverlay';
import { WheelParticles } from './render/wheelParticles';
import { TireTracks } from './render/tireTracks';

const container = document.getElementById('app');
if (!container) throw new Error('Missing #app container');

const terrain = new Terrain(new NoiseHeightSource(WORLD.seed));
const world = new SimWorld(terrain);

const input = new KeyboardInput();
input.attach(window);

const { renderer, scene, camera, sky } = createScene(container);
const terrainView = new TerrainView(scene, terrain);
const scatterView = new ScatterView(scene, terrain);
const vehicleView = new VehicleView(scene, terrain);
const opponentViews = world.racerViews.map(
  (rv, i) => new VehicleView(scene, terrain, rv.spec.color, i + 1),
);
const checkpointView = new CheckpointView(scene, terrain, world.race.checkpoints);
const wheelParticles = new WheelParticles(scene, terrain);
const tireTracks = new TireTracks(scene, terrain);
const cameraRig = new CameraRig(camera, terrain);
const ui = new GameUi(container, () => input.pushAction());
const hud = new Hud(container, ui.best);
const debugOverlay = new DebugOverlay(container);

let started = false;
let paused = false;
let finishShown = false;
let clock = 0;

const forward = new THREE.Vector3();

const loop = new FixedLoop(
  SIM.dt,
  (dt) => {
    if (input.takeAction()) {
      if (!started) {
        started = true;
        ui.hideStart();
      } else if (paused) {
        paused = false;
        ui.setPaused(false);
      } else if (world.raceState.phase === 'finished') {
        world.restartRace();
        finishShown = false;
        ui.hideFinish();
        hud.setBest(ui.best);
      }
    }
    if (input.takePause() && started) {
      paused = !paused;
      ui.setPaused(paused);
    }
    if (input.takeDebugToggle()) debugOverlay.toggle();
    if (input.takeReset()) world.resetRequested = true;

    if (started && !paused) {
      world.step(input.state, dt);
      clock += dt;
    }
  },
  (alpha, frameDt) => {
    vehicleView.update(world.prev, world.curr, alpha);
    for (let i = 0; i < opponentViews.length; i++) {
      opponentViews[i].update(world.racerViews[i].prev, world.racerViews[i].curr, alpha);
    }
    wheelParticles.update(frameDt);
    tireTracks.update(frameDt);
    wheelParticles.emitVehicle(0, vehicleView, world.curr, frameDt);
    tireTracks.emitVehicle(0, vehicleView, world.curr);
    for (let i = 0; i < opponentViews.length; i++) {
      wheelParticles.emitVehicle(i + 1, opponentViews[i], world.racerViews[i].curr, frameDt);
      tireTracks.emitVehicle(i + 1, opponentViews[i], world.racerViews[i].curr);
    }
    terrainView.update(vehicleView.group.position.x, vehicleView.group.position.z);
    scatterView.update(vehicleView.group.position.x, vehicleView.group.position.z);
    checkpointView.update(world.raceState, clock);
    cameraRig.update(vehicleView.group.position, vehicleView.group.quaternion, frameDt);
    sky.position.copy(camera.position);

    forward.set(0, 0, 1).applyQuaternion(vehicleView.group.quaternion);
    hud.update(world.curr, world.raceState, Math.atan2(forward.x, forward.z));
    debugOverlay.update(world, input.state);

    if (world.raceState.phase === 'finished' && !finishShown) {
      finishShown = true;
      ui.showFinish(
        world.raceState.finishTime ?? 0,
        world.raceState.position,
        world.raceState.total,
      );
    }

    renderer.render(scene, camera);
  },
);

loop.start();

if (import.meta.env.DEV) {
  // Dev console handle for poking the sim (not part of any layer contract).
  const { forEachItemNear } = await import('./terrain/scatter');
  (window as unknown as Record<string, unknown>).__terep = {
    world,
    terrain,
    forEachItemNear,
    wheelParticles,
    tireTracks,
  };
}
