/**
 * Chassis-vs-scatter collision: the body is approximated by two horizontal
 * probe spheres; trunks and boulders push back with a damped penalty force.
 * Wheels deliberately ignore scatter — hitting a tree is a chassis event.
 */

import { Vec3, clamp } from '../core/math';
import { SCATTER, WORLD } from '../config';
import { forEachItemNear } from '../terrain/scatter';
import type { Terrain } from '../terrain/terrain';
import type { RigidBody } from './rigidbody';

const probeLocal = new Vec3();
const probe = new Vec3();
const pointVel = new Vec3();
const force = new Vec3();

/** Widest item radius plus probe radius, for the cell search range. */
const SEARCH_RANGE = SCATTER.collision.probeRadius + 1.5;

export function applyObstacleForces(body: RigidBody, terrain: Terrain, _dt: number): void {
  const col = SCATTER.collision;

  for (const dz of [col.probeZ, -col.probeZ]) {
    body.localToWorld(probeLocal.set(0, col.probeY, dz), probe);

    forEachItemNear(probe.x, probe.z, SEARCH_RANGE, terrain, WORLD.seed, (item) => {
      if (item.radius <= 0) return;
      // No hit if the chassis is flying above the obstacle.
      if (probe.y - col.probeRadius > item.y + item.height) return;

      const dx = probe.x - item.x;
      const dzc = probe.z - item.z;
      const dist = Math.hypot(dx, dzc);
      const minDist = col.probeRadius + item.radius;
      if (dist >= minDist || dist < 1e-6) return;

      const nx = dx / dist;
      const nz = dzc / dist;
      body.velocityAt(probe, pointVel);
      const approach = Math.min(0, pointVel.x * nx + pointVel.z * nz);
      const magnitude = clamp(
        col.stiffness * (minDist - dist) - col.damping * approach,
        0,
        col.maxForce,
      );
      force.set(nx * magnitude, 0, nz * magnitude);
      body.applyForce(force, probe);
    });
  }
}
