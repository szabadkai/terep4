/**
 * Vehicle visuals: the lofted jeep body (see jeepModel.ts), wheels with
 * visible suspension travel, and a blob shadow. Consumes interpolated sim
 * snapshots and never writes back to the sim.
 */

import * as THREE from 'three';
import { BUGGY, COLORS } from '../config';
import type { VehicleSnapshot } from '../sim/snapshot';
import type { Terrain } from '../terrain/terrain';
import { buildJeep } from './jeepModel';

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
  private readonly brakeLights: THREE.MeshBasicMaterial[] = [];
  private readonly shadow: THREE.Mesh;
  private readonly quatA = new THREE.Quaternion();
  private readonly quatB = new THREE.Quaternion();

  constructor(
    scene: THREE.Scene,
    private readonly terrain: Terrain,
    bodyColor?: number,
    variant = 0,
  ) {
    const model = buildJeep(bodyColor, {
      accentColor: accentFor(bodyColor ?? COLORS.body, variant),
      variant,
    });
    model.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.name === 'brakeLight') {
        this.brakeLights.push(obj.material as THREE.MeshBasicMaterial);
      }
    });
    this.group.add(model);
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
      // Positive sim steer points the wheel toward -X (car right), which is
      // a negative yaw rotation in Three's convention.
      steerGroup.rotation.y = -lerpAngle(wp.steer, wc.steer, alpha);
      this.wheelMeshes[i].rotation.x = lerpAngle(wp.spin, wc.spin, alpha);
    }

    this.updateBrakeLights(lerp(prev.controls.brake, curr.controls.brake));
    this.updateShadow();
  }

  private updateBrakeLights(brake: number): void {
    const active = brake > 0.08;
    for (const mat of this.brakeLights) {
      mat.color.setHex(active ? 0xff2b16 : COLORS.taillight);
      mat.opacity = active ? 1 : 0.72;
    }
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

  private buildWheels(): void {
    const tireGeo = new THREE.CylinderGeometry(1, 1, 1, 9);
    tireGeo.rotateZ(Math.PI / 2); // axle along X
    const hubGeo = new THREE.CylinderGeometry(0.5, 0.5, 1.06, 9);
    hubGeo.rotateZ(Math.PI / 2);
    const tireMat = new THREE.MeshLambertMaterial({ color: COLORS.wheel, flatShading: true });
    const hubMat = new THREE.MeshLambertMaterial({ color: COLORS.hub, flatShading: true });

    for (const w of BUGGY.wheels) {
      const steerGroup = new THREE.Group();
      steerGroup.position.set(w.offset.x, w.offset.y, w.offset.z);
      const tire = new THREE.Mesh(tireGeo, tireMat);
      tire.scale.set(0.3, w.radius, w.radius);
      tire.add(new THREE.Mesh(hubGeo, hubMat));
      steerGroup.add(tire);
      this.group.add(steerGroup);
      this.steerGroups.push(steerGroup);
      this.wheelMeshes.push(tire);
    }
  }
}

function accentFor(bodyColor: number, variant: number): number {
  if (variant === 0) return 0xf0d14d;
  const color = new THREE.Color(bodyColor);
  color.offsetHSL(0.08 * variant, 0.1, 0.18);
  return color.getHex();
}
