/**
 * Low-poly buggy visuals. Consumes interpolated sim snapshots — chassis
 * pose, per-wheel suspension length, steer and spin — and never writes back
 * to the sim. The visible suspension travel is the point of the exercise.
 */

import * as THREE from 'three';
import { BUGGY, COLORS } from '../config';
import type { VehicleSnapshot } from '../sim/snapshot';
import type { Terrain } from '../terrain/terrain';

const TWO_PI = Math.PI * 2;

/** Lerp an angle along the shortest path (handles wrap at ±π). */
function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  else if (d < -Math.PI) d += TWO_PI;
  return a + d * t;
}

export class VehicleView {
  readonly group = new THREE.Group();
  private readonly steerGroups: THREE.Group[] = [];
  private readonly wheelMeshes: THREE.Mesh[] = [];
  private readonly shadow: THREE.Mesh;
  private readonly quatA = new THREE.Quaternion();
  private readonly quatB = new THREE.Quaternion();

  constructor(
    scene: THREE.Scene,
    private readonly terrain: Terrain,
  ) {
    this.buildChassis();
    this.buildWheels();
    scene.add(this.group);

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1.7, 16),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    scene.add(this.shadow);
  }

  update(prev: VehicleSnapshot, curr: VehicleSnapshot, alpha: number): void {
    const lerp = (a: number, b: number) => a + (b - a) * alpha;

    this.group.position.set(
      lerp(prev.pos.x, curr.pos.x),
      lerp(prev.pos.y, curr.pos.y),
      lerp(prev.pos.z, curr.pos.z),
    );
    this.quatA.set(prev.quat.x, prev.quat.y, prev.quat.z, prev.quat.w);
    this.quatB.set(curr.quat.x, curr.quat.y, curr.quat.z, curr.quat.w);
    this.group.quaternion.slerpQuaternions(this.quatA, this.quatB, alpha);

    for (let i = 0; i < this.wheelMeshes.length; i++) {
      const wp = prev.wheels[i];
      const wc = curr.wheels[i];
      const steerGroup = this.steerGroups[i];
      steerGroup.position.y = BUGGY.wheels[i].offset.y - lerp(wp.suspLen, wc.suspLen);
      steerGroup.rotation.y = lerpAngle(wp.steer, wc.steer, alpha);
      this.wheelMeshes[i].rotation.x = lerpAngle(wp.spin, wc.spin, alpha);
    }

    this.updateShadow();
  }

  private updateShadow(): void {
    const p = this.group.position;
    const ground = this.terrain.height(p.x, p.z);
    this.shadow.position.set(p.x, ground + 0.05, p.z);
    const altitude = Math.max(0, p.y - ground - 0.9);
    const fade = Math.max(0, 1 - altitude / 6);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.3 * fade;
    this.shadow.visible = fade > 0.01;
  }

  private buildChassis(): void {
    const { width, height, length, centerY } = BUGGY.chassis;
    const bodyMat = new THREE.MeshLambertMaterial({ color: COLORS.body, flatShading: true });
    const cabinMat = new THREE.MeshLambertMaterial({ color: COLORS.cabin, flatShading: true });

    const body = new THREE.Mesh(new THREE.BoxGeometry(width, height * 0.5, length), bodyMat);
    body.position.y = centerY - height * 0.1;
    this.group.add(body);

    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.78, height * 0.45, length * 0.4),
      cabinMat,
    );
    cabin.position.set(0, centerY + height * 0.32, -length * 0.08);
    this.group.add(cabin);

    const bumper = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.9, height * 0.22, 0.22),
      cabinMat,
    );
    bumper.position.set(0, centerY - height * 0.22, length / 2 + 0.08);
    this.group.add(bumper);
  }

  private buildWheels(): void {
    const geometry = new THREE.CylinderGeometry(1, 1, 1, 9);
    geometry.rotateZ(Math.PI / 2); // axle along X
    const material = new THREE.MeshLambertMaterial({ color: COLORS.wheel, flatShading: true });

    for (const w of BUGGY.wheels) {
      const steerGroup = new THREE.Group();
      steerGroup.position.set(w.offset.x, w.offset.y, w.offset.z);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.scale.set(0.3, w.radius, w.radius);
      steerGroup.add(mesh);
      this.group.add(steerGroup);
      this.steerGroups.push(steerGroup);
      this.wheelMeshes.push(mesh);
    }
  }
}
