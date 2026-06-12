/**
 * All tuning constants for the game live here — physics, terrain generation,
 * surfaces, camera, colors. No magic numbers in logic code.
 */

export const SIM = {
  /** Fixed physics timestep (s). */
  dt: 1 / 60,
  gravity: 9.81,
  /** Auto-respawn if the chassis falls below this height (m). */
  killHeight: -80,
};

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export type SurfaceId = 'grass' | 'rock' | 'mud' | 'snow' | 'water';

export interface SurfaceParams {
  /** Tire friction coefficient multiplier. */
  friction: number;
  /** Rolling resistance: force = coeff * wheel load, opposing rolling. */
  rollingResistance: number;
  /** Velocity drag applied at the wheel contact, N per (m/s). Water resistance. */
  drag: number;
}

export const SURFACES: Record<SurfaceId, SurfaceParams> = {
  grass: { friction: 1.0, rollingResistance: 0.015, drag: 0 },
  rock: { friction: 1.1, rollingResistance: 0.008, drag: 0 },
  mud: { friction: 0.55, rollingResistance: 0.05, drag: 60 },
  snow: { friction: 0.45, rollingResistance: 0.025, drag: 20 },
  water: { friction: 0.4, rollingResistance: 0.04, drag: 320 },
};

// ---------------------------------------------------------------------------
// Vehicle
// ---------------------------------------------------------------------------

export interface WheelConfig {
  /** Suspension attachment point in chassis space (origin = center of mass). */
  offset: { x: number; y: number; z: number };
  radius: number;
  driven: boolean;
  steered: boolean;
  /** Affected by the handbrake. */
  handbraked: boolean;
}

export interface VehicleConfig {
  mass: number;
  /** Chassis collision box (full extents, m) and its center offset from the COM. */
  chassis: { width: number; height: number; length: number; centerY: number };
  /** Scales the box inertia tensor; >1 makes rotation lazier/more stable. */
  inertiaScale: number;
  engine: {
    /** Peak total drive force (N), split across driven wheels. */
    maxForce: number;
    /** Drive force fades linearly to zero at this forward speed (m/s). */
    maxSpeed: number;
    reverseForce: number;
    maxReverseSpeed: number;
  };
  brakes: {
    /** Per-wheel brake force at full pedal (N). */
    force: number;
    /** Extra per-wheel force on handbraked wheels (N). */
    handbrakeForce: number;
    /** Lateral grip multiplier on handbraked wheels while the handbrake is on. */
    handbrakeGrip: number;
  };
  steering: {
    maxAngle: number;
    /** Steering speed, rad/s. */
    rate: number;
    /** Max angle is divided by (1 + speed * speedFalloff). */
    speedFalloff: number;
  };
  suspension: {
    restLength: number;
    maxTravel: number;
    /** Spring rate N/m. */
    stiffness: number;
    /** Damping N per (m/s), separate for compression and rebound. */
    dampingCompression: number;
    dampingRebound: number;
    /** Progressive bump stop engages past this fraction of maxTravel. */
    bumpStopAt: number;
    bumpStopStiffness: number;
  };
  tires: {
    /** Lateral force response: N per N of load per (m/s) of lateral slip. */
    corneringResponse: number;
    /** Global grip multiplier on top of surface friction. */
    grip: number;
  };
  aero: {
    /** Quadratic drag: force = drag * speed^2 (N). */
    drag: number;
    linearDamping: number;
    angularDamping: number;
  };
  collision: {
    stiffness: number;
    damping: number;
    friction: number;
  };
  wheels: WheelConfig[];
}

const TRACK = 0.82; // half the track width
const WHEELBASE = 1.32; // half the wheelbase
const ATTACH_Y = -0.12;
const WHEEL_RADIUS = 0.37;

export const BUGGY: VehicleConfig = {
  mass: 1200,
  chassis: { width: 1.7, height: 1.1, length: 3.6, centerY: 0.35 },
  inertiaScale: 1.1,
  engine: { maxForce: 7200, maxSpeed: 38, reverseForce: 4200, maxReverseSpeed: 12 },
  brakes: { force: 2300, handbrakeForce: 3200, handbrakeGrip: 0.5 },
  steering: { maxAngle: 0.58, rate: 3.2, speedFalloff: 0.055 },
  suspension: {
    restLength: 0.5,
    maxTravel: 0.34,
    stiffness: 21000,
    dampingCompression: 1900,
    dampingRebound: 2700,
    bumpStopAt: 0.85,
    bumpStopStiffness: 140000,
  },
  tires: { corneringResponse: 5.0, grip: 1.0 },
  aero: { drag: 1.5, linearDamping: 0.02, angularDamping: 0.6 },
  collision: { stiffness: 52000, damping: 3200, friction: 0.55 },
  wheels: [
    {
      offset: { x: -TRACK, y: ATTACH_Y, z: WHEELBASE },
      radius: WHEEL_RADIUS,
      driven: true,
      steered: true,
      handbraked: false,
    },
    {
      offset: { x: TRACK, y: ATTACH_Y, z: WHEELBASE },
      radius: WHEEL_RADIUS,
      driven: true,
      steered: true,
      handbraked: false,
    },
    {
      offset: { x: -TRACK, y: ATTACH_Y, z: -WHEELBASE },
      radius: WHEEL_RADIUS,
      driven: true,
      steered: false,
      handbraked: true,
    },
    {
      offset: { x: TRACK, y: ATTACH_Y, z: -WHEELBASE },
      radius: WHEEL_RADIUS,
      driven: true,
      steered: false,
      handbraked: true,
    },
  ],
};

// ---------------------------------------------------------------------------
// World / terrain generation
// ---------------------------------------------------------------------------

export const WORLD = {
  seed: 1337,
  waterLevel: 0,
  /** Snow appears above roughly this height (m), modulated by noise. */
  snowLine: 26,
  /** Terrain steeper than this (surface normal y below it) reads as rock. */
  rockSlope: 0.78,
  /** Shoreline band above water level that turns to mud (m). */
  mudShore: 1.3,
  gen: {
    mountainWavelength: 620,
    mountainAmplitude: 30,
    hillWavelength: 95,
    hillAmplitudeMin: 4.5,
    hillAmplitudeMax: 8,
    bumpWavelength: 8,
    bumpAmplitude: 0.5,
    baseHeight: 2.5,
    /** Big relief fades in between these radii from the origin (m). */
    reliefStart: 120,
    reliefEnd: 450,
    /** Spawn area is blended flat inside this radius band (m). */
    spawnFlatInner: 30,
    spawnFlatOuter: 110,
    spawnHeight: 3,
    /** How much of the small bump noise survives on the spawn pad. */
    spawnBumpScale: 0.35,
    /** Wavelength of the noise that scatters mud/rock patches (m). */
    patchWavelength: 55,
  },
};

export const CHUNKS = {
  /** Chunk side length (m). */
  size: 80,
  /** Grid cells per chunk side. */
  cells: 32,
  /** Chunks are kept loaded within this many chunks of the vehicle. */
  viewRadius: 4,
  /** Max chunks built per render frame once the initial area is in. */
  buildsPerFrame: 1,
};

export const CAMERA = {
  fov: 70,
  distance: 8.5,
  height: 3.4,
  lookAhead: 4,
  lookUp: 1.2,
  /** Position smoothing rate, 1/s. Higher = stiffer follow. */
  stiffness: 5,
  minTerrainClearance: 0.7,
  near: 0.3,
  far: 900,
};

// ---------------------------------------------------------------------------
// Render palette
// ---------------------------------------------------------------------------

export const COLORS = {
  surfaces: {
    grass: 0x69a04a,
    rock: 0x8b8275,
    mud: 0x6e5639,
    snow: 0xe9eef3,
    water: 0x7c6f52, // lake/river bed shows through the water plane
  } as Record<SurfaceId, number>,
  water: 0x3a7ba6,
  waterOpacity: 0.75,
  fog: 0xcfe0ea,
  skyHorizon: 0xd8e8f0,
  skyZenith: 0x6fa8d6,
  hemiSky: 0xbfd8e8,
  hemiGround: 0x6a7a5a,
  body: 0xc8472f,
  cabin: 0x2c3c4c,
  wheel: 0x222222,
  fogNear: 130,
  fogFar: 390,
  /** Per-face brightness jitter for the low-poly look (fraction). */
  faceJitter: 0.07,
};
