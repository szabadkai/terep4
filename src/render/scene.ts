/**
 * Three.js scene setup: renderer, camera, lights, fog and a gradient sky
 * dome. Render-layer only — it reads sim snapshots, never touches sim state.
 */

import * as THREE from 'three';
import { CAMERA, COLORS, RENDER } from '../config';

export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sky: THREE.Mesh;
}

export function createScene(container: HTMLElement): SceneContext {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(COLORS.fog, COLORS.fogNear, COLORS.fogFar);

  const camera = new THREE.PerspectiveCamera(
    CAMERA.fov,
    window.innerWidth / window.innerHeight,
    CAMERA.near,
    CAMERA.far,
  );

  const hemi = new THREE.HemisphereLight(COLORS.hemiSky, COLORS.hemiGround, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(60, 120, 40);
  scene.add(sun);

  const sky = createSkyDome();
  scene.add(sky);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { renderer, scene, camera, sky };
}

/** Inside-out sphere with a vertical horizon→zenith gradient. */
function createSkyDome(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      horizon: { value: new THREE.Color(COLORS.skyHorizon) },
      zenith: { value: new THREE.Color(COLORS.skyZenith) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 horizon;
      uniform vec3 zenith;
      varying vec3 vDir;
      void main() {
        float t = pow(max(vDir.y, 0.0), 0.55);
        gl_FragColor = vec4(mix(horizon, zenith, t), 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), material);
  mesh.scale.setScalar(CAMERA.far * 0.9);
  mesh.frustumCulled = false;
  return mesh;
}
