import { createServer } from 'vite';

const BASE_TIME_LIMIT = 240;
const SETTLE_TICKS = 90;
const PRESET_SELECTIONS = [
  { length: 'short', difficulty: 'mild' },
  { length: 'short', difficulty: 'standard' },
  { length: 'short', difficulty: 'wild' },
  { length: 'standard', difficulty: 'mild' },
  { length: 'standard', difficulty: 'standard' },
  { length: 'standard', difficulty: 'wild' },
  { length: 'long', difficulty: 'mild' },
  { length: 'long', difficulty: 'standard' },
  { length: 'long', difficulty: 'wild' },
];

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom',
});

try {
  const [
    { SIM, WORLD, OPPONENTS },
    { Terrain, NoiseHeightSource },
    { Race },
    { Racer },
    { Vec3 },
    { coursePreset },
  ] = await Promise.all([
    server.ssrLoadModule('/src/config.ts'),
    server.ssrLoadModule('/src/terrain/terrain.ts'),
    server.ssrLoadModule('/src/sim/race.ts'),
    server.ssrLoadModule('/src/sim/racer.ts'),
    server.ssrLoadModule('/src/core/math.ts'),
    server.ssrLoadModule('/src/sim/coursePreset.ts'),
  ]);

  const terrain = new Terrain(new NoiseHeightSource(WORLD.seed));
  const up = new Vec3(0, 1, 0);
  const worldUp = new Vec3();
  let failed = 0;

  for (const selection of PRESET_SELECTIONS) {
    const preset = coursePreset(selection);
    const timeLimit = Math.max(BASE_TIME_LIMIT, preset.checkpointCount * 38);
    const race = new Race(terrain, WORLD.seed, selection);
    const racers = OPPONENTS.map((spec) => new Racer(spec, terrain, race.checkpoints));

    for (const racer of racers) racer.reset();
    for (let i = 0; i < SETTLE_TICKS; i++) {
      for (const racer of racers) racer.step(SIM.dt, false, 0);
    }

    const stats = racers.map(() => ({
      stuckEvents: 0,
      resetEvents: 0,
      minUpright: 1,
      maxSpeed: 0,
      speedSum: 0,
      samples: 0,
      lastRecoveryState: 'normal',
    }));

    let clock = 0;
    while (clock < timeLimit && racers.some((r) => !r.finished)) {
      clock += SIM.dt;
      for (let i = 0; i < racers.length; i++) {
        const racer = racers[i];
        racer.step(SIM.dt, true, clock);

        const s = stats[i];
        const speed = Math.hypot(racer.vehicle.body.vel.x, racer.vehicle.body.vel.z);
        s.maxSpeed = Math.max(s.maxSpeed, speed);
        s.speedSum += speed;
        s.samples++;
        racer.vehicle.body.localDirToWorld(up, worldUp);
        s.minUpright = Math.min(s.minUpright, worldUp.y);

        const recoveryState = racer.telemetry.recoveryState;
        if (recoveryState !== 'normal' && s.lastRecoveryState === 'normal') s.stuckEvents++;
        if (recoveryState === 'reset-if-hopeless' && s.lastRecoveryState !== 'reset-if-hopeless') {
          s.resetEvents++;
        }
        s.lastRecoveryState = recoveryState;
      }
    }

    console.log(
      `AI race test seed=${WORLD.seed} preset=${preset.label} checkpoints=${race.checkpoints.length}`,
    );
    console.log(`time limit ${timeLimit}s, simulated ${clock.toFixed(1)}s`);
    console.log('');

    let unfinished = 0;
    for (let i = 0; i < racers.length; i++) {
      const racer = racers[i];
      const s = stats[i];
      if (!racer.finished) unfinished++;
      const avgSpeed = s.samples > 0 ? s.speedSum / s.samples : 0;
      const status = racer.finished
        ? `finished ${racer.finishTime?.toFixed(1)}s`
        : 'WARNING unfinished';
      console.log(
        [
          racer.spec.name.padEnd(10),
          status.padEnd(22),
          `cp ${racer.current}/${race.checkpoints.length}`,
          `avg ${(avgSpeed * 3.6).toFixed(0)} km/h`,
          `max ${(s.maxSpeed * 3.6).toFixed(0)} km/h`,
          `recover ${s.stuckEvents}`,
          `reset ${s.resetEvents}`,
          `minUp ${s.minUpright.toFixed(2)}`,
        ].join(' | '),
      );
    }

    console.log('');
    if (unfinished > 0) {
      failed += unfinished;
      console.log(`WARNING: ${unfinished} AI racer(s) did not finish within ${timeLimit}s.`);
      console.log('');
    }
  }

  if (failed > 0) {
    throw new Error(`${failed} preset AI run(s) did not finish.`);
  }
} finally {
  await server.close();
}
