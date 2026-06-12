/**
 * Composition root. Wires input → sim (fixed timestep) → render
 * (interpolated). This is the only file that sees all three layers.
 */

import { SIM, WORLD } from './config';
import { FixedLoop } from './core/loop';
import { KeyboardInput } from './input/input';
import { Terrain, NoiseHeightSource } from './terrain/terrain';
import { SimWorld } from './sim/world';
import { createScene } from './render/scene';
import { TerrainView } from './render/terrainView';
import { VehicleView } from './render/vehicleView';
import { CameraRig } from './render/cameraRig';
import { Hud } from './render/hud';

const container = document.getElementById('app');
if (!container) throw new Error('Missing #app container');

const terrain = new Terrain(new NoiseHeightSource(WORLD.seed));
const world = new SimWorld(terrain);

const input = new KeyboardInput();
input.attach(window);

const { renderer, scene, camera, sky } = createScene(container);
const terrainView = new TerrainView(scene, terrain);
const vehicleView = new VehicleView(scene, terrain);
const cameraRig = new CameraRig(camera, terrain);
const hud = new Hud(container);

const loop = new FixedLoop(
  SIM.dt,
  (dt) => {
    if (input.takeReset()) world.resetRequested = true;
    world.step(input.state, dt);
  },
  (alpha, frameDt) => {
    vehicleView.update(world.prev, world.curr, alpha);
    terrainView.update(vehicleView.group.position.x, vehicleView.group.position.z);
    cameraRig.update(vehicleView.group.position, vehicleView.group.quaternion, frameDt);
    sky.position.copy(camera.position);
    hud.update(world.curr);
    renderer.render(scene, camera);
  },
);

loop.start();

if (import.meta.env.DEV) {
  // Dev console handle for poking the sim (not part of any layer contract).
  (window as unknown as Record<string, unknown>).__terep = { world, terrain };
}
