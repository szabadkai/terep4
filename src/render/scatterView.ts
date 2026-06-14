/**
 * Renders the deterministic scatter (pines, leafy trees, boulders) as one
 * InstancedMesh per kind per chunk, streamed with the same lifecycle as the
 * terrain chunks. Templates are merged low-poly primitives with baked
 * vertex colors; per-instance tint breaks up the repetition.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHUNKS, COLORS, WORLD } from '../config';
import { itemsInRect, type ScatterItem, type ScatterKind } from '../terrain/scatter';
import { hash2 } from '../terrain/noise';
import type { Terrain } from '../terrain/terrain';

const tmpMatrix = new THREE.Matrix4();
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpColor = new THREE.Color();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export class ScatterView {
  private readonly chunks = new Map<string, THREE.Group>();
  private readonly templates: Record<ScatterKind, THREE.BufferGeometry>;
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true });

  constructor(
    private readonly scene: THREE.Scene,
    private readonly terrain: Terrain,
  ) {
    this.templates = { pine: pineTemplate(), tree: treeTemplate(), boulder: boulderTemplate() };
  }

  update(focusX: number, focusZ: number): void {
    const size = CHUNKS.size;
    const ccx = Math.floor(focusX / size);
    const ccz = Math.floor(focusZ / size);
    const r = CHUNKS.viewRadius;

    for (let cx = ccx - r; cx <= ccx + r; cx++) {
      for (let cz = ccz - r; cz <= ccz + r; cz++) {
        const key = `${cx},${cz}`;
        if (!this.chunks.has(key)) {
          const group = this.buildChunk(cx, cz);
          this.chunks.set(key, group);
          this.scene.add(group);
        }
      }
    }

    for (const [key, group] of this.chunks) {
      const [cx, cz] = key.split(',').map(Number);
      if (Math.max(Math.abs(cx - ccx), Math.abs(cz - ccz)) > r + 1) {
        this.scene.remove(group);
        for (const child of group.children) (child as THREE.InstancedMesh).dispose();
        this.chunks.delete(key);
      }
    }
  }

  private buildChunk(cx: number, cz: number): THREE.Group {
    const size = CHUNKS.size;
    const items = itemsInRect(
      cx * size,
      cz * size,
      (cx + 1) * size,
      (cz + 1) * size,
      this.terrain,
      WORLD.seed,
    );
    const group = new THREE.Group();

    for (const kind of ['pine', 'tree', 'boulder'] as ScatterKind[]) {
      const ofKind = items.filter((i) => i.kind === kind);
      if (ofKind.length === 0) continue;
      group.add(this.buildInstances(kind, ofKind));
    }
    return group;
  }

  private buildInstances(kind: ScatterKind, items: ScatterItem[]): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.templates[kind], this.material, items.length);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      tmpPos.set(item.x, item.y, item.z);
      tmpQuat.setFromAxisAngle(Y_AXIS, item.rotation);
      tmpScale.setScalar(item.size);
      mesh.setMatrixAt(i, tmpMatrix.compose(tmpPos, tmpQuat, tmpScale));
      const tint = 0.85 + 0.3 * hash2(Math.round(item.x * 3), Math.round(item.z * 3), 97);
      mesh.setColorAt(i, tmpColor.setScalar(tint));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    return mesh;
  }
}

/** Non-indexed (flat-shaded) geometry with a baked uniform vertex color. */
function paint(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const flat = geo.toNonIndexed();
  geo.dispose();
  flat.computeVertexNormals();
  const c = new THREE.Color(hex);
  const count = flat.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return flat;
}

function pineTemplate(): THREE.BufferGeometry {
  return mergeGeometries([
    paint(new THREE.CylinderGeometry(0.09, 0.13, 1.0, 5).translate(0, 0.5, 0), COLORS.trunk),
    paint(new THREE.ConeGeometry(0.95, 1.7, 7).translate(0, 1.7, 0), COLORS.pine),
    paint(new THREE.ConeGeometry(0.66, 1.4, 7).translate(0, 2.7, 0), COLORS.pine),
    paint(new THREE.ConeGeometry(0.4, 1.1, 7).translate(0, 3.55, 0), COLORS.pine),
  ]);
}

function treeTemplate(): THREE.BufferGeometry {
  return mergeGeometries([
    paint(new THREE.CylinderGeometry(0.12, 0.17, 1.3, 5).translate(0, 0.65, 0), COLORS.trunk),
    paint(
      new THREE.IcosahedronGeometry(1.15, 0).scale(1, 0.85, 1).translate(0, 2.0, 0),
      COLORS.leaf,
    ),
    paint(
      new THREE.IcosahedronGeometry(0.7, 0).scale(1, 0.8, 1).translate(0.55, 2.55, 0.2),
      COLORS.leaf,
    ),
  ]);
}

function boulderTemplate(): THREE.BufferGeometry {
  return paint(
    new THREE.IcosahedronGeometry(1, 0).scale(1, 0.72, 1.15).translate(0, 0.45, 0),
    COLORS.boulder,
  );
}
