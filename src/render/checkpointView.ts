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
const GATE_WIDTH = RACE.captureRadius * 1.12;
const PASS_BURST_TIME = 0.85;

interface Gate {
  group: THREE.Group;
  burstGroup: THREE.Group;
  beam: THREE.MeshBasicMaterial;
  flag: THREE.MeshBasicMaterial;
  banner: THREE.MeshBasicMaterial;
  ring: THREE.MeshBasicMaterial;
  halo: THREE.MeshBasicMaterial;
  flagMesh: THREE.Mesh;
  ringMesh: THREE.Mesh;
  burstRing: THREE.MeshBasicMaterial;
  burstPoints: THREE.PointsMaterial;
  burstTime: number;
}

export class CheckpointView {
  private readonly gates: Gate[] = [];
  private readonly next = new THREE.Color(COLORS.checkpointNext);
  private readonly far = new THREE.Color(COLORS.checkpointFar);
  private previousCurrent = 0;
  private previousPhase: RaceState['phase'] = 'ready';
  private lastTimeSec = 0;

  constructor(scene: THREE.Scene, terrain: Terrain, checkpoints: readonly Checkpoint[]) {
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.09, POLE_HEIGHT, 6);
    const sidePoleGeo = new THREE.CylinderGeometry(0.08, 0.08, POLE_HEIGHT * 0.92, 6);
    const crossbarGeo = new THREE.CylinderGeometry(0.06, 0.06, GATE_WIDTH, 6);
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
    const bannerGeo = new THREE.PlaneGeometry(GATE_WIDTH * 0.86, 0.8);
    const ringGeo = new THREE.TorusGeometry(RACE.captureRadius, 0.12, 6, 36);
    const haloGeo = new THREE.RingGeometry(
      RACE.captureRadius * 0.58,
      RACE.captureRadius * 1.02,
      36,
    );
    const burstRingGeo = new THREE.TorusGeometry(RACE.captureRadius * 0.5, 0.18, 6, 28);
    const burstPointsGeo = makeBurstPoints();
    const poleMat = new THREE.MeshLambertMaterial({ color: COLORS.trim });

    for (const cp of checkpoints) {
      const group = new THREE.Group();
      group.position.set(cp.x, terrain.height(cp.x, cp.z), cp.z);

      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.y = POLE_HEIGHT / 2;
      group.add(pole);

      for (const x of [-GATE_WIDTH / 2, GATE_WIDTH / 2]) {
        const sidePole = new THREE.Mesh(sidePoleGeo, poleMat);
        sidePole.position.set(x, (POLE_HEIGHT * 0.92) / 2, 0);
        group.add(sidePole);
      }

      const crossbar = new THREE.Mesh(crossbarGeo, poleMat);
      crossbar.position.y = POLE_HEIGHT * 0.9;
      crossbar.rotation.z = Math.PI / 2;
      group.add(crossbar);

      const flagMat = new THREE.MeshBasicMaterial({ color: this.far, side: THREE.DoubleSide });
      const flagMesh = new THREE.Mesh(flagGeo, flagMat);
      flagMesh.position.y = POLE_HEIGHT - 0.05;
      group.add(flagMesh);

      const bannerMat = new THREE.MeshBasicMaterial({
        color: this.far,
        transparent: true,
        opacity: 0.34,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const banner = new THREE.Mesh(bannerGeo, bannerMat);
      banner.position.y = POLE_HEIGHT * 0.72;
      banner.position.z = 0.04;
      group.add(banner);

      const ringMat = new THREE.MeshBasicMaterial({
        color: this.far,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = 0.22;
      ring.rotation.x = Math.PI / 2;
      group.add(ring);

      const haloMat = new THREE.MeshBasicMaterial({
        color: this.far,
        transparent: true,
        opacity: 0.08,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const halo = new THREE.Mesh(haloGeo, haloMat);
      halo.position.y = 0.08;
      halo.rotation.x = -Math.PI / 2;
      group.add(halo);

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

      const burstGroup = new THREE.Group();
      burstGroup.position.copy(group.position);
      burstGroup.visible = false;

      const burstRingMat = new THREE.MeshBasicMaterial({
        color: this.next,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const burstRing = new THREE.Mesh(burstRingGeo, burstRingMat);
      burstRing.position.y = 1.1;
      burstRing.rotation.x = Math.PI / 2;
      burstGroup.add(burstRing);

      const burstPointsMat = new THREE.PointsMaterial({
        color: this.next,
        transparent: true,
        opacity: 0,
        size: 0.8,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const burstPoints = new THREE.Points(burstPointsGeo, burstPointsMat);
      burstPoints.position.y = 1.1;
      burstGroup.add(burstPoints);

      scene.add(group);
      scene.add(burstGroup);
      this.gates.push({
        group,
        burstGroup,
        beam: beamMat,
        flag: flagMat,
        banner: bannerMat,
        ring: ringMat,
        halo: haloMat,
        flagMesh,
        ringMesh: ring,
        burstRing: burstRingMat,
        burstPoints: burstPointsMat,
        burstTime: 0,
      });
    }
  }

  update(state: RaceState, timeSec: number): void {
    const dt = Math.min(0.1, Math.max(0, timeSec - this.lastTimeSec));
    this.lastTimeSec = timeSec;
    this.updatePassBursts(state);

    for (let i = 0; i < this.gates.length; i++) {
      const gate = this.gates[i];
      const passed = state.phase === 'finished' || i < state.current;
      gate.group.visible = !passed;
      this.updateBurst(gate, timeSec, dt);
      if (passed) continue;

      const isNext = i === state.current;
      const pulse = 0.5 + 0.5 * Math.sin(timeSec * 5);
      const slowPulse = 0.5 + 0.5 * Math.sin(timeSec * 2.4);
      gate.beam.color = isNext ? this.next : this.far;
      gate.beam.opacity = isNext ? 0.25 + 0.14 * pulse : 0.08;
      gate.flag.color = isNext ? this.next : this.far;
      gate.banner.color = isNext ? this.next : this.far;
      gate.banner.opacity = isNext ? 0.58 + 0.18 * pulse : 0.22;
      gate.ring.color = isNext ? this.next : this.far;
      gate.ring.opacity = isNext ? 0.44 + 0.16 * pulse : 0.12;
      gate.halo.color = isNext ? this.next : this.far;
      gate.halo.opacity = isNext ? 0.14 + 0.08 * slowPulse : 0.04;
      gate.flagMesh.rotation.y = timeSec * (isNext ? 2.5 : 1.1);
      gate.ringMesh.scale.setScalar(isNext ? 1 + 0.035 * pulse : 1);
    }
  }

  private updatePassBursts(state: RaceState): void {
    if (state.phase === 'ready' && this.previousPhase !== 'ready') {
      for (const gate of this.gates) {
        gate.burstTime = 0;
        gate.burstGroup.visible = false;
      }
      this.previousCurrent = 0;
      this.lastTimeSec = 0;
    }

    if (state.current > this.previousCurrent) {
      for (let i = this.previousCurrent; i < state.current; i++) {
        this.triggerBurst(i);
      }
    }
    this.previousCurrent = state.current;
    this.previousPhase = state.phase;
  }

  private triggerBurst(index: number): void {
    const gate = this.gates[index];
    if (!gate) return;
    gate.burstTime = PASS_BURST_TIME;
    gate.burstGroup.visible = true;
    gate.burstGroup.scale.setScalar(0.35);
  }

  private updateBurst(gate: Gate, timeSec: number, dt: number): void {
    if (gate.burstTime <= 0) {
      gate.burstGroup.visible = false;
      return;
    }
    gate.burstTime = Math.max(0, gate.burstTime - dt);
    const t = 1 - gate.burstTime / PASS_BURST_TIME;
    const fade = 1 - t;
    gate.burstGroup.visible = true;
    gate.burstGroup.scale.setScalar(0.4 + t * 1.8);
    gate.burstGroup.rotation.y = timeSec * 1.8;
    gate.burstRing.opacity = fade * 0.7;
    gate.burstPoints.opacity = fade * 0.9;
  }
}

function makeBurstPoints(): THREE.BufferGeometry {
  const positions: number[] = [];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const r = RACE.captureRadius * (0.5 + (i % 3) * 0.15);
    positions.push(Math.sin(a) * r, 0.5 + (i % 4) * 0.4, Math.cos(a) * r);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}
