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

export const RENDER = {
  /** Rendering above this does not add useful motion clarity for this game. */
  maxFps: 60,
  /** High-DPI displays get expensive quickly; keep the low-poly style crisp enough. */
  maxPixelRatio: 1.5,
};

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export type SurfaceId = 'grass' | 'rock' | 'mud' | 'sand' | 'snow' | 'water';
export type BiomeId =
  | 'grassland'
  | 'pineForest'
  | 'marsh'
  | 'rockyHighlands'
  | 'snowRidge'
  | 'sandyShore'
  | 'riverValley';

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
  sand: { friction: 0.78, rollingResistance: 0.045, drag: 25 },
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
  chassis: { width: 1.7, height: 1.45, length: 3.6, centerY: 0.35 },
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
  /** Shoreline band above water level that turns to sand (m). */
  sandShore: 1.1,
  gen: {
    /** Domain warp applied to the large noise layers, for organic shapes. */
    warpWavelength: 240,
    warpStrength: 60,
    /** Ridged-noise mountain ranges. */
    mountainWavelength: 540,
    mountainAmplitude: 34,
    hillWavelength: 110,
    hillAmplitudeMin: 5,
    hillAmplitudeMax: 9,
    bumpWavelength: 8,
    bumpAmplitude: 0.5,
    baseHeight: 2.0,
    /** Winding river channels carved below water level. */
    riverWavelength: 420,
    riverWidth: 0.14,
    riverDepth: 7,
    /** Rivers fade in between these radii so they skip the spawn pad (m). */
    riverFadeStart: 60,
    riverFadeEnd: 160,
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

export const SCATTER = {
  /** One scatter candidate per grid cell of this size (m). */
  cell: 9,
  /** No scatter inside this radius around the spawn pad (m). */
  clearRadius: 22,
  /** Wavelength of the noise that groups trees into forests (m). */
  forestWavelength: 150,
  /** Tree probability: baseline + forest bonus. */
  treeBase: 0.04,
  treeForest: 0.55,
  /** Boulders use the top slice of the placement hash. */
  boulderChance: 0.008,
  /** No trees above this terrain height (treeline, m). */
  treeline: 22,
  /** No trees on slopes steeper than this (surface normal y). */
  maxSlope: 0.8,
  /** Collision trunk radius per unit of item size (m). */
  trunkRadius: 0.16,
  boulderRadius: 0.62,
  collision: {
    stiffness: 70000,
    damping: 5000,
    maxForce: 60000,
    /** The chassis is approximated by two spheres for obstacle hits. */
    probeRadius: 0.95,
    probeZ: 1.15,
    probeY: 0.2,
  },
};

export const RACE = {
  /** Number of checkpoints in one race loop. */
  checkpointCount: 8,
  /** Checkpoints sit on a ring of roughly this radius around spawn (m). */
  ringRadius: 270,
  /** Random radial variation of checkpoint placement (m). */
  ringJitter: 80,
  /** Horizontal distance that counts as passing a checkpoint (m). */
  captureRadius: 14,
  /** The race clock starts when speed first exceeds this (m/s). */
  startSpeed: 0.8,
  /** Flooded checkpoints get pushed outward in steps this large (m). */
  landSearchStep: 18,
  landSearchTries: 40,
  /** Checkpoints need terrain at least this far above water level (m). */
  minLandHeight: 0.6,
};

// ---------------------------------------------------------------------------
// AI opponents
// ---------------------------------------------------------------------------

export interface OpponentSpec {
  name: string;
  /** Body paint color. */
  color: number;
  /** Lateral offset from the start line, so cars don't stack (m). */
  startOffset: number;
  /** 0..1 skill: scales target speed and steering precision. */
  skill: number;
  /** Driving behavior multipliers; 1 is neutral. */
  profile: AiDriverProfile;
  /** Engine power multiplier vs. the player buggy. */
  power: number;
  /** Top-speed multiplier vs. the player buggy. */
  topSpeed: number;
}

export interface AiDriverProfile {
  /** Higher values carry more speed and brake later. */
  aggression: number;
  /** Higher values avoid and slow down more for bad surfaces. */
  terrainCaution: number;
  /** Higher values spend longer recovering before giving up/resetting. */
  recoveryPatience: number;
  /** Higher values brake earlier and harder. */
  brakeBias: number;
  /** Multiplier for the AI's target cruise speed. */
  preferredSpeed: number;
}

export const OPPONENTS: OpponentSpec[] = [
  {
    name: 'Sárkány',
    color: 0x3b7dd8,
    startOffset: -3.2,
    skill: 0.97,
    profile: {
      aggression: 1.08,
      terrainCaution: 0.96,
      recoveryPatience: 1.08,
      brakeBias: 0.98,
      preferredSpeed: 1.06,
    },
    power: 1.05,
    topSpeed: 1.03,
  },
  {
    name: 'Borz',
    color: 0x4caf50,
    startOffset: 3.2,
    skill: 0.91,
    profile: {
      aggression: 0.94,
      terrainCaution: 1.03,
      recoveryPatience: 1.06,
      brakeBias: 1.1,
      preferredSpeed: 0.96,
    },
    power: 0.99,
    topSpeed: 0.98,
  },
  {
    name: 'Vaddisznó',
    color: 0xe0a32e,
    startOffset: -6.4,
    skill: 0.86,
    profile: {
      aggression: 0.96,
      terrainCaution: 1.04,
      recoveryPatience: 0.95,
      brakeBias: 1.06,
      preferredSpeed: 0.99,
    },
    power: 0.98,
    topSpeed: 0.96,
  },
];

/** Derive an opponent's vehicle config from the player buggy + its spec. */
export function opponentConfig(spec: OpponentSpec): VehicleConfig {
  return {
    ...BUGGY,
    engine: {
      ...BUGGY.engine,
      maxForce: BUGGY.engine.maxForce * spec.power,
      maxSpeed: BUGGY.engine.maxSpeed * spec.topSpeed,
    },
  };
}

export const AI = {
  /** Steering gain: target steer = clamp(gain * bearingError). */
  steerGain: 2.2,
  /** Nominal cruise speed for skilled AI on easy terrain (m/s). */
  cruiseSpeed: 25,
  /** Lowest speed target while still trying to drive forward (m/s). */
  minTargetSpeed: 5,
  /** Ease off throttle when |bearing error| exceeds this (rad). */
  cautionAngle: 0.5,
  /** Brake when |bearing error| exceeds this and moving fast (rad). */
  brakeAngle: 1.1,
  /** Start treating the chassis as risky when its local up vector drops here. */
  tiltCautionUp: 0.82,
  /** Crawl if the chassis is tilted at/under this local-up dot. */
  tiltDangerUp: 0.62,
  /** Roll/pitch angular speed where AI begins to lift (rad/s). */
  tumbleCautionRate: 1.7,
  /** Roll/pitch angular speed that forces a crawl (rad/s). */
  tumbleDangerRate: 3.3,
  /** Throttle multiplier when most grounded wheels are sliding. */
  slideThrottle: 0.45,
  /** Terrain speed multipliers by surface under grounded wheels. */
  surfaceSpeed: {
    grass: 1,
    rock: 0.9,
    mud: 0.64,
    sand: 0.72,
    snow: 0.66,
    water: 0.58,
  },
  /** Floor after personality terrain-caution scaling. */
  minSurfaceSpeedMultiplier: 0.24,
  /** Below this target-speed fraction, don't brake (let it coast/turn). */
  brakeSpeed: 14,
  /** Minimum lookahead past the current checkpoint at low speed (m). */
  lookaheadMin: 16,
  /** Maximum lookahead past the current checkpoint at high speed (m). */
  lookaheadMax: 58,
  /** Speed that reaches maximum checkpoint lookahead (m/s). */
  lookaheadSpeed: 26,
  /** Terrain-aware route sampling distance in front of the AI (m). */
  avoidScanDist: 78,
  /** Maximum lateral route offset considered to avoid bad terrain (m). */
  avoidLateralOffset: 54,
  /** How quickly AI route offset follows the best sampled line (1/s). */
  avoidOffsetSmoothing: 3.2,
  /** When already in bad terrain, search this far for a dry exit (m). */
  escapeScanDist: 64,
  /** Start easing the throttle within this distance of the gate (m)... */
  approachDist: 30,
  /** ...but only when the heading is off by more than this (rad)... */
  approachAngle: 0.35,
  /** ...down to at most this throttle fraction, so the turn radius tucks in. */
  approachThrottle: 0.4,
  /** Considered stuck if horizontal speed stays under this (m/s)... */
  stuckSpeed: 0.7,
  /** ...for this long (s); then reverse to unstick. */
  stuckTime: 5.5,
  /** Also reverse when distance to the checkpoint fails to improve this long. */
  poorProgressTime: 8,
  /** Minimum checkpoint-distance improvement per second before AI worries. */
  minProgressRate: 0.08,
  /** Duration of the reverse-unstick maneuver (s). */
  unstickTime: 1.1,
  /** Brief stop before backing out of a stuck state (s). */
  recoveryPauseTime: 0.28,
  /** Extra reverse time added for repeated stuck attempts at one checkpoint (s). */
  recoveryRepeatReverseBonus: 0.22,
  /** Low-throttle forward crawl after reversing (s). */
  recoveryCrawlTime: 1.25,
  /** Forward throttle used during recovery crawl. */
  recoveryCrawlThrottle: 0.38,
  /** Reset in place after this many failed recovery attempts at one checkpoint. */
  recoveryMaxAttemptsPerCheckpoint: 3,
  /** AI reset candidates cannot improve checkpoint distance by more than this many meters. */
  recoveryResetProgressTolerance: 10,
  /** Local-up dot below this means the AI is nearly upside down. */
  recoveryRolloverUp: 0.28,
  /** Time nearly upside down before the AI gives up and resets (s). */
  recoveryRolloverTime: 1.75,
  /** Time spent in reset-if-hopeless state after the vehicle reset is applied. */
  recoveryResetHoldTime: 0.35,
  /** Capture radius for AI checkpoints. Larger than the player's so a fast
   * AI passing near a gate counts it rather than orbiting forever at its
   * minimum turn radius. */
  captureRadius: 22,
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
    sand: 0xd6bd85,
    snow: 0xe9eef3,
    water: 0x7c6f52, // lake/river bed shows through the water plane
  } as Record<SurfaceId, number>,
  /** Secondary face tints (see TerrainView.faceColor). */
  grassDry: 0x9fae54,
  biomeTint: {
    grassland: 0x78a957,
    pineForest: 0x315f3d,
    marsh: 0x536f47,
    rockyHighlands: 0x827c6e,
    snowRidge: 0xdce8ef,
    sandyShore: 0xd0b06f,
    riverValley: 0x6c8a58,
  } as Record<BiomeId, number>,
  rockSteep: 0x675d52,
  trunk: 0x5d4630,
  pine: 0x3a6438,
  leaf: 0x55903d,
  boulder: 0x8a857c,
  water: 0x3a7ba6,
  waterOpacity: 0.75,
  fog: 0xcfe0ea,
  skyHorizon: 0xd8e8f0,
  skyZenith: 0x6fa8d6,
  hemiSky: 0xbfd8e8,
  hemiGround: 0x6a7a5a,
  body: 0xb13325,
  glass: 0x18242f,
  trim: 0x23292f,
  headlight: 0xffd97a,
  taillight: 0x7e1c10,
  wheel: 0x1d1d1f,
  hub: 0x9aa0a6,
  checkpointNext: 0xffc63a,
  checkpointFar: 0x9fb4c8,
  fogNear: 130,
  fogFar: 390,
  /** Per-face brightness jitter for the low-poly look (fraction). */
  faceJitter: 0.07,
};
