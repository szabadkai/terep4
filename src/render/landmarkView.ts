import * as THREE from 'three';
import { COLORS, RACE, WORLD, type BiomeId } from '../config';
import type { Checkpoint } from '../sim/race';
import type { LocationZone } from '../terrain/locationZones';
import { hash2 } from '../terrain/noise';
import type { Terrain } from '../terrain/terrain';

type LandmarkType =
  | 'watchtower'
  | 'cabin'
  | 'radioMast'
  | 'wreckedCar'
  | 'bannerPoles'
  | 'stoneArch'
  | 'floodlightRig';

const STYLE_LANDMARKS: Record<LocationZone['landmarkStyle'], readonly LandmarkType[]> = {
  ridge: ['radioMast', 'stoneArch', 'floodlightRig'],
  woods: ['watchtower', 'cabin', 'bannerPoles'],
  wetland: ['wreckedCar', 'floodlightRig', 'bannerPoles'],
  flats: ['stoneArch', 'bannerPoles', 'floodlightRig'],
  pass: ['bannerPoles', 'radioMast', 'stoneArch'],
  shore: ['cabin', 'wreckedCar', 'bannerPoles'],
};

const MAJOR_STYLE_LANDMARKS: Record<LocationZone['landmarkStyle'], LandmarkType> = {
  ridge: 'radioMast',
  woods: 'watchtower',
  wetland: 'wreckedCar',
  flats: 'stoneArch',
  pass: 'bannerPoles',
  shore: 'cabin',
};

const BIOME_LANDMARKS: Record<BiomeId, readonly LandmarkType[]> = {
  grassland: ['stoneArch', 'bannerPoles', 'floodlightRig'],
  pineForest: ['watchtower', 'cabin', 'bannerPoles'],
  marsh: ['wreckedCar', 'floodlightRig', 'bannerPoles'],
  rockyHighlands: ['radioMast', 'stoneArch', 'floodlightRig'],
  snowRidge: ['bannerPoles', 'radioMast', 'stoneArch'],
  sandyShore: ['cabin', 'wreckedCar', 'bannerPoles'],
  riverValley: ['wreckedCar', 'cabin', 'floodlightRig'],
};

const LANDMARK_COLLISION_RADIUS: Record<LandmarkType, number> = {
  watchtower: 1.8,
  cabin: 2.0,
  radioMast: 1.35,
  wreckedCar: 1.8,
  bannerPoles: 1.8,
  stoneArch: 2.0,
  floodlightRig: 1.5,
};

const GROUND_LIFT = 0.05;
const TWO_PI = Math.PI * 2;

interface LandmarkPlacement {
  x: number;
  z: number;
  rotation: number;
}

export class LandmarkView {
  private readonly group = new THREE.Group();
  private readonly mats = {
    wood: new THREE.MeshLambertMaterial({ color: COLORS.deadWood }),
    dark: new THREE.MeshLambertMaterial({ color: COLORS.trim }),
    roof: new THREE.MeshLambertMaterial({ color: 0x4b3a2e }),
    stone: new THREE.MeshLambertMaterial({ color: COLORS.boulder }),
    metal: new THREE.MeshLambertMaterial({ color: 0x889098 }),
    paint: new THREE.MeshLambertMaterial({ color: COLORS.markerPaint }),
    flag: new THREE.MeshLambertMaterial({ color: COLORS.checkpointNext, side: THREE.DoubleSide }),
    glass: new THREE.MeshLambertMaterial({ color: COLORS.glass }),
    light: new THREE.MeshBasicMaterial({ color: COLORS.headlight }),
    body: new THREE.MeshLambertMaterial({ color: COLORS.body }),
  };

  constructor(
    scene: THREE.Scene,
    private readonly terrain: Terrain,
    checkpoints: readonly Checkpoint[],
  ) {
    for (const zone of terrain.locationZones) {
      const type = MAJOR_STYLE_LANDMARKS[zone.landmarkStyle];
      const placement = this.zoneLandmarkPlacement(zone, checkpoints);
      this.addLandmark(type, placement, 1000 + zone.id, 1.2, {
        scope: 'zone',
        zone: zone.name,
        biome: zone.biome,
        landmarkStyle: zone.landmarkStyle,
      });
    }

    for (let i = 0; i < checkpoints.length; i++) {
      const cp = checkpoints[i];
      const placement = this.landmarkPlacement(checkpoints, i);
      const zone =
        terrain.locationZone(cp.x, cp.z) ?? terrain.locationZone(placement.x, placement.z);
      const biome = zone?.biome ?? terrain.biome(placement.x, placement.z);
      const type = this.minorTypeForCheckpoint(i, zone, biome);
      this.addLandmark(type, placement, i, 1, {
        scope: 'checkpoint',
        checkpoint: i,
        zone: zone?.name ?? null,
        biome,
        checkpointDistance: Math.hypot(placement.x - cp.x, placement.z - cp.z),
      });
    }
    scene.add(this.group);
  }

  private landmarkPlacement(checkpoints: readonly Checkpoint[], index: number): LandmarkPlacement {
    const cp = checkpoints[index];
    const prev = checkpoints[(index - 1 + checkpoints.length) % checkpoints.length];
    const next = checkpoints[(index + 1) % checkpoints.length];
    const tx = next.x - prev.x;
    const tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    const nx = -tz / len;
    const nz = tx / len;
    const tangentX = tx / len;
    const tangentZ = tz / len;
    const side = hash2(index, 42, WORLD.seed) < 0.5 ? -1 : 1;
    const offset = RACE.captureRadius * 1.9 + hash2(index, 43, WORLD.seed) * 10;
    const slide = (hash2(index, 44, WORLD.seed) - 0.5) * RACE.captureRadius * 0.8;
    let x = cp.x + nx * side * offset + tangentX * slide;
    let z = cp.z + nz * side * offset + tangentZ * slide;

    for (let tries = 0; tries < 8; tries++) {
      const dist = Math.hypot(x - cp.x, z - cp.z);
      if (
        this.isReadableGround(x, z) &&
        dist > RACE.captureRadius * 1.45 &&
        this.isClearOfCheckpoints(x, z, checkpoints, RACE.captureRadius * 1.25)
      ) {
        break;
      }
      const angle = Math.atan2(nx * side, nz * side) + (tries - 3) * 0.32;
      const retryOffset = offset + tries * 3;
      x = cp.x + Math.sin(angle) * retryOffset;
      z = cp.z + Math.cos(angle) * retryOffset;
    }

    return { x, z, rotation: Math.atan2(cp.x - x, cp.z - z) };
  }

  private zoneLandmarkPlacement(
    zone: LocationZone,
    checkpoints: readonly Checkpoint[],
  ): LandmarkPlacement {
    const maxRadius = Math.min(zone.radius * 0.36, 56);
    let best: LandmarkPlacement = {
      x: zone.center.x,
      z: zone.center.z,
      rotation: Math.atan2(-zone.center.x, -zone.center.z),
    };
    let bestScore = this.landmarkPlacementScore(
      best.x,
      best.z,
      checkpoints,
      RACE.captureRadius * 2.2,
    );

    for (let tries = 0; tries < 16; tries++) {
      const angle = hash2(zone.id, 70 + tries, WORLD.seed) * TWO_PI + tries * 0.31;
      const distance = maxRadius * (0.18 + hash2(zone.id, 90 + tries, WORLD.seed) * 0.82);
      const x = zone.center.x + Math.sin(angle) * distance;
      const z = zone.center.z + Math.cos(angle) * distance;
      const insideZone = Math.hypot(x - zone.center.x, z - zone.center.z) < zone.radius * 0.62;
      const score =
        this.landmarkPlacementScore(x, z, checkpoints, RACE.captureRadius * 2.2) +
        (insideZone ? 0 : 50) +
        distance / maxRadius;
      const candidate = { x, z, rotation: Math.atan2(zone.center.x - x, zone.center.z - z) };

      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
      if (
        insideZone &&
        this.isReadableGround(x, z) &&
        this.isClearOfCheckpoints(x, z, checkpoints, RACE.captureRadius * 2.2)
      ) {
        return candidate;
      }
    }

    return best;
  }

  private addLandmark(
    type: LandmarkType,
    placement: LandmarkPlacement,
    index: number,
    scaleBoost: number,
    userData: Record<string, unknown>,
  ): void {
    const landmark = this.build(type, index, scaleBoost);
    landmark.position.set(
      placement.x,
      this.terrain.height(placement.x, placement.z) + GROUND_LIFT,
      placement.z,
    );
    landmark.rotation.y = placement.rotation;
    landmark.userData = {
      ...userData,
      type,
      collisionRadius: LANDMARK_COLLISION_RADIUS[type] * scaleBoost,
    };
    this.group.add(landmark);
  }

  private minorTypeForCheckpoint(
    index: number,
    zone: LocationZone | null,
    biome: BiomeId,
  ): LandmarkType {
    const choices = zone ? STYLE_LANDMARKS[zone.landmarkStyle] : BIOME_LANDMARKS[biome];
    return choices[
      Math.min(choices.length - 1, Math.floor(hash2(index, 41, WORLD.seed) * choices.length))
    ];
  }

  private isClearOfCheckpoints(
    x: number,
    z: number,
    checkpoints: readonly Checkpoint[],
    minDistance: number,
  ): boolean {
    return checkpoints.every((cp) => Math.hypot(x - cp.x, z - cp.z) >= minDistance);
  }

  private isReadableGround(x: number, z: number): boolean {
    const h = this.terrain.height(x, z);
    if (h <= WORLD.waterLevel + 0.7) return false;
    const e = 2.4;
    const maxDelta = Math.max(
      Math.abs(h - this.terrain.height(x + e, z)),
      Math.abs(h - this.terrain.height(x - e, z)),
      Math.abs(h - this.terrain.height(x, z + e)),
      Math.abs(h - this.terrain.height(x, z - e)),
    );
    return maxDelta < 3.4;
  }

  private landmarkPlacementScore(
    x: number,
    z: number,
    checkpoints: readonly Checkpoint[],
    minDistance: number,
  ): number {
    const groundScore = this.isReadableGround(x, z) ? 0 : 80;
    const nearestCheckpoint = checkpoints.reduce(
      (nearest, cp) => Math.min(nearest, Math.hypot(x - cp.x, z - cp.z)),
      Number.POSITIVE_INFINITY,
    );
    const checkpointScore =
      nearestCheckpoint >= minDistance ? 0 : ((minDistance - nearestCheckpoint) / minDistance) * 80;
    return groundScore + checkpointScore;
  }

  private build(type: LandmarkType, index: number, scaleBoost: number): THREE.Group {
    const group = new THREE.Group();
    const scale = (0.9 + hash2(index, 45, WORLD.seed) * 0.28) * scaleBoost;
    group.scale.setScalar(scale);
    switch (type) {
      case 'watchtower':
        this.watchtower(group);
        break;
      case 'cabin':
        this.cabin(group);
        break;
      case 'radioMast':
        this.radioMast(group);
        break;
      case 'wreckedCar':
        this.wreckedCar(group);
        break;
      case 'bannerPoles':
        this.bannerPoles(group);
        break;
      case 'stoneArch':
        this.stoneArch(group);
        break;
      case 'floodlightRig':
        this.floodlightRig(group);
        break;
    }
    return group;
  }

  private watchtower(group: THREE.Group): void {
    for (const x of [-0.9, 0.9]) {
      for (const z of [-0.9, 0.9]) {
        const leg = cyl(0.07, 4.0, this.mats.wood, 5);
        leg.position.set(x, 2.0, z);
        leg.rotation.z = x * 0.05;
        leg.rotation.x = -z * 0.05;
        group.add(leg);
      }
    }
    group.add(box(2.3, 0.22, 2.3, this.mats.wood, 0, 3.1, 0));
    group.add(box(1.8, 0.9, 1.8, this.mats.paint, 0, 3.65, 0));
    group.add(cone(1.55, 0.8, this.mats.roof, 4, 0, 4.45, 0, Math.PI / 4));
  }

  private cabin(group: THREE.Group): void {
    group.add(box(2.8, 1.4, 2.1, this.mats.wood, 0, 0.7, 0));
    const roof = box(3.1, 0.35, 2.5, this.mats.roof, 0, 1.6, 0);
    roof.rotation.z = 0.12;
    group.add(roof);
    group.add(box(0.48, 0.7, 0.2, this.mats.dark, 0, 0.4, 1.08));
    group.add(box(0.45, 0.34, 0.08, this.mats.glass, -0.72, 0.9, 1.1));
    group.add(box(0.28, 0.72, 0.28, this.mats.stone, 0.88, 2.05, -0.46));
  }

  private radioMast(group: THREE.Group): void {
    group.add(cyl(0.055, 6.4, this.mats.metal, 6, 0, 3.2, 0));
    for (const y of [1.7, 3.1, 4.5]) {
      const bar = cyl(0.035, 2.2, this.mats.metal, 5, 0, y, 0);
      bar.rotation.z = Math.PI / 2;
      group.add(bar);
      const cross = cyl(0.028, 1.8, this.mats.metal, 5, 0, y + 0.08, 0);
      cross.rotation.x = Math.PI / 2;
      group.add(cross);
    }
    group.add(cone(0.26, 0.55, this.mats.light, 8, 0, 6.68, 0));
  }

  private wreckedCar(group: THREE.Group): void {
    const body = box(2.4, 0.55, 1.15, this.mats.body, 0, 0.45, 0);
    body.rotation.z = -0.1;
    group.add(body);
    group.add(box(0.95, 0.45, 0.95, this.mats.glass, -0.18, 0.92, -0.02));
    for (const x of [-0.82, 0.82]) {
      for (const z of [-0.52, 0.52]) {
        const wheel = cyl(0.24, 0.22, this.mats.dark, 9, x, 0.25, z);
        wheel.rotation.x = Math.PI / 2;
        group.add(wheel);
      }
    }
    group.add(box(0.7, 0.08, 1.25, this.mats.metal, 0.88, 0.76, 0));
  }

  private bannerPoles(group: THREE.Group): void {
    for (const x of [-1.4, 1.4]) {
      group.add(cyl(0.07, 3.2, this.mats.wood, 6, x, 1.6, 0));
    }
    const rope = cyl(0.025, 2.9, this.mats.dark, 5, 0, 2.8, 0);
    rope.rotation.z = Math.PI / 2;
    group.add(rope);
    for (const x of [-0.75, 0, 0.75]) {
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.72), this.mats.flag);
      flag.position.set(x, 2.35, 0.05);
      flag.rotation.y = 0.08;
      group.add(flag);
    }
  }

  private stoneArch(group: THREE.Group): void {
    group.add(box(0.72, 2.0, 0.78, this.mats.stone, -1.0, 1.0, 0));
    group.add(box(0.72, 2.0, 0.78, this.mats.stone, 1.0, 1.0, 0));
    group.add(box(2.7, 0.6, 0.82, this.mats.stone, 0, 2.18, 0));
    group.add(box(0.6, 0.28, 0.7, this.mats.stone, -1.24, 2.62, 0.02));
    group.add(box(0.58, 0.22, 0.74, this.mats.stone, 1.2, 2.56, -0.02));
  }

  private floodlightRig(group: THREE.Group): void {
    group.add(cyl(0.075, 3.4, this.mats.metal, 6, 0, 1.7, 0));
    for (const x of [-0.7, 0.7]) {
      const leg = cyl(0.045, 2.0, this.mats.metal, 5, x * 0.45, 0.85, 0);
      leg.rotation.z = x * 0.32;
      group.add(leg);
    }
    const head = box(1.55, 0.6, 0.28, this.mats.dark, 0, 3.55, 0.02);
    head.rotation.x = -0.22;
    group.add(head);
    for (const x of [-0.42, 0.42]) {
      group.add(box(0.45, 0.32, 0.08, this.mats.light, x, 3.54, 0.2));
    }
  }
}

function box(
  sx: number,
  sy: number,
  sz: number,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

function cyl(
  radius: number,
  height: number,
  mat: THREE.Material,
  sides: number,
  x = 0,
  y = height / 2,
  z = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, sides), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

function cone(
  radius: number,
  height: number,
  mat: THREE.Material,
  sides: number,
  x: number,
  y: number,
  z: number,
  rotY = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(radius, height, sides), mat);
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotY;
  return mesh;
}
