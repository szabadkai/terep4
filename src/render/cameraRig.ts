/**
 * Smoothed chase camera: sits behind the vehicle's heading, eases toward
 * its target with exponential damping, and stays above the terrain.
 */

import * as THREE from 'three';
import { CAMERA } from '../config';
import type { Terrain } from '../terrain/terrain';

const forward = new THREE.Vector3();
const desired = new THREE.Vector3();
const lookTarget = new THREE.Vector3();

export class CameraRig {
  private readonly lastForward = new THREE.Vector3(0, 0, 1);
  private initialized = false;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly terrain: Terrain,
  ) {}

  update(targetPos: THREE.Vector3, targetQuat: THREE.Quaternion, dt: number): void {
    forward.set(0, 0, 1).applyQuaternion(targetQuat);
    forward.y = 0;
    if (forward.lengthSq() < 1e-4) {
      forward.copy(this.lastForward);
    } else {
      forward.normalize();
      this.lastForward.copy(forward);
    }

    desired.copy(targetPos).addScaledVector(forward, -CAMERA.distance);
    desired.y += CAMERA.height;

    if (!this.initialized) {
      this.camera.position.copy(desired);
      this.initialized = true;
    } else {
      const t = 1 - Math.exp(-CAMERA.stiffness * dt);
      this.camera.position.lerp(desired, t);
    }

    // Keep the camera out of the ground.
    const minY =
      this.terrain.height(this.camera.position.x, this.camera.position.z) +
      CAMERA.minTerrainClearance;
    if (this.camera.position.y < minY) this.camera.position.y = minY;

    lookTarget.copy(targetPos).addScaledVector(forward, CAMERA.lookAhead);
    lookTarget.y += CAMERA.lookUp;
    this.camera.lookAt(lookTarget);
  }
}
