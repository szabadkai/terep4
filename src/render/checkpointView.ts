/**
 * Checkpoint markers: a pole with a spinning pennant and a tall translucent
 * light beam visible over hills. The next checkpoint glows and pulses;
 * passed ones disappear. Reads RaceState only.
 */

import * as THREE from 'three';
import { COLORS, RACE } from '../config';
import type { Checkpoint, RaceState } from '../sim/race';
import type { Terrain } from '../terrain/terrain';

const BEAM_HEIGHT = 30;
const POLE_HEIGHT = 5;

interface Gate {
  group: THREE.Group;
  beam: THREE.MeshBasicMaterial;
  flag: THREE.MeshBasicMaterial;
  flagMesh: THREE.Mesh;
}

export class CheckpointView {
  private readonly gates: Gate[] = [];
  private readonly next = new THREE.Color(COLORS.checkpointNext);
  private readonly far = new THREE.Color(COLORS.checkpointFar);

  constructor(scene: THREE.Scene, terrain: Terrain, checkpoints: readonly Checkpoint[]) {
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.09, POLE_HEIGHT, 6);
    const beamGeo = new THREE.CylinderGeometry(
      RACE.captureRadius * 0.45,
      RACE.captureRadius * 0.45,
      BEAM_HEIGHT,
      10,
      1,
      true,
    );
    const flagGeo = new THREE.BufferGeometry();
    flagGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 0, -0.55, 0, 1.25, -0.27, 0], 3),
    );
    const poleMat = new THREE.MeshLambertMaterial({ color: COLORS.trim });

    for (const cp of checkpoints) {
      const group = new THREE.Group();
      group.position.set(cp.x, terrain.height(cp.x, cp.z), cp.z);

      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.y = POLE_HEIGHT / 2;
      group.add(pole);

      const flagMat = new THREE.MeshBasicMaterial({ color: this.far, side: THREE.DoubleSide });
      const flagMesh = new THREE.Mesh(flagGeo, flagMat);
      flagMesh.position.y = POLE_HEIGHT - 0.05;
      group.add(flagMesh);

      const beamMat = new THREE.MeshBasicMaterial({
        color: this.far,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.y = BEAM_HEIGHT / 2;
      group.add(beam);

      scene.add(group);
      this.gates.push({ group, beam: beamMat, flag: flagMat, flagMesh });
    }
  }

  update(state: RaceState, timeSec: number): void {
    for (let i = 0; i < this.gates.length; i++) {
      const gate = this.gates[i];
      const passed = state.phase === 'finished' || i < state.current;
      gate.group.visible = !passed;
      if (passed) continue;

      const isNext = i === state.current;
      gate.beam.color = isNext ? this.next : this.far;
      gate.beam.opacity = isNext ? 0.26 + 0.1 * Math.sin(timeSec * 5) : 0.1;
      gate.flag.color = isNext ? this.next : this.far;
      gate.flagMesh.rotation.y = timeSec * 1.6;
    }
  }
}
