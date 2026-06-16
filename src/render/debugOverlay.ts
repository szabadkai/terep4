import type { InputState } from '../input/input';
import type { SimWorld } from '../sim/world';
import { formatTime } from './hud';

const SURFACE_LABELS: Record<string, string> = {
  grass: 'grass',
  rock: 'rock',
  mud: 'mud',
  sand: 'sand',
  snow: 'snow',
  water: 'water',
};

const BIOME_LABELS: Record<string, string> = {
  grassland: 'open grassland',
  pineForest: 'pine forest',
  marsh: 'marsh',
  rockyHighlands: 'rocky highlands',
  snowRidge: 'snow ridge',
  sandyShore: 'sandy shore',
  riverValley: 'river valley',
};

export class DebugOverlay {
  private readonly el: HTMLElement;
  private visible = false;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'debug-overlay';
    container.appendChild(this.el);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.classList.toggle('visible', this.visible);
  }

  update(world: SimWorld, input: InputState): void {
    if (!this.visible) return;

    const player = world.vehicle;
    const pPos = player.body.pos;
    const pVel = player.body.vel;
    const playerGrounded = player.wheels.filter((w) => w.grounded);
    const playerSliding = player.wheels.filter((w) => w.sliding);
    const race = world.raceState;
    const next = race.next;
    const playerCpDist = next ? Math.hypot(next.x - pPos.x, next.z - pPos.z) : 0;
    const playerBiome = world.terrain.biome(pPos.x, pPos.z);

    this.el.innerHTML = `
      <div class="debug-title">DEBUG <span>F3</span></div>
      <div class="debug-grid">
        <span>phase</span><b>${race.phase}</b>
        <span>countdown</span><b>${race.countdownRemaining.toFixed(1)}s</b>
        <span>time</span><b>${formatTime(race.finishTime ?? race.elapsed)}</b>
        <span>position</span><b>${race.position}/${race.total}</b>
        <span>checkpoint</span><b>${Math.min(race.current + 1, race.count)}/${race.count}</b>
        <span>cp dist</span><b>${playerCpDist.toFixed(1)}m</b>
      </div>
      <div class="debug-section">
        <h2>Player</h2>
        <div class="debug-grid">
          <span>speed</span><b>${(Math.hypot(pVel.x, pVel.z) * 3.6).toFixed(0)} km/h</b>
          <span>forward</span><b>${player.forwardSpeed().toFixed(1)} m/s</b>
          <span>yaw</span><b>${radToDeg(player.yaw()).toFixed(0)} deg</b>
          <span>input</span><b>T ${input.throttle.toFixed(1)} B ${input.brake.toFixed(1)} S ${input.steer.toFixed(1)}${input.handbrake ? ' HB' : ''}</b>
          <span>wheels</span><b>${playerGrounded.length}/4 grounded · ${playerSliding.length} sliding</b>
          <span>surface</span><b>${surfaceName(playerGrounded)}</b>
          <span>biome</span><b>${BIOME_LABELS[playerBiome]}</b>
        </div>
      </div>
      <div class="debug-section">
        <h2>AI</h2>
        ${world.racers.map((r) => this.aiRow(world, r, race.count)).join('')}
      </div>
    `;
  }

  private aiRow(
    world: SimWorld,
    racer: SimWorld['racers'][number],
    checkpointCount: number,
  ): string {
    const vehicle = racer.vehicle;
    const cpDist = racer.distanceToCheckpoint();
    const grounded = vehicle.wheels.filter((w) => w.grounded);
    const sliding = vehicle.wheels.filter((w) => w.sliding);
    const pos = vehicle.body.pos;
    const biome = world.terrain.biome(pos.x, pos.z);
    const t = racer.telemetry;
    return `
      <div class="debug-ai">
        <h3>${racer.spec.name} <span>CP ${Math.min(racer.current + 1, checkpointCount)}/${checkpointCount}</span></h3>
        <div class="debug-grid">
          <span>speed/target</span><b>${(Math.hypot(vehicle.body.vel.x, vehicle.body.vel.z) * 3.6).toFixed(0)} km/h · ${t.targetSpeed.toFixed(1)} m/s</b>
          <span>profile</span><b>A ${t.profile.aggression.toFixed(2)} T ${t.profile.terrainCaution.toFixed(2)} R ${t.profile.recoveryPatience.toFixed(2)} B ${t.profile.brakeBias.toFixed(2)} S ${t.profile.preferredSpeed.toFixed(2)}</b>
          <span>cp dist</span><b>${cpDist.toFixed(1)}m</b>
          <span>error</span><b>${radToDeg(t.bearingError).toFixed(0)} deg</b>
          <span>surface mul</span><b>${t.surfaceMultiplier.toFixed(2)}</b>
          <span>wheels</span><b>${grounded.length}/4 grounded · ${sliding.length} sliding</b>
          <span>surface</span><b>${surfaceName(grounded)}</b>
          <span>biome</span><b>${BIOME_LABELS[biome]}</b>
          <span>slide ratio</span><b>${t.slideRatio.toFixed(2)}</b>
          <span>upright</span><b>${t.upright.toFixed(2)}</b>
          <span>tumble</span><b>${t.tumbleRate.toFixed(2)}</b>
          <span>recovery</span><b>${t.recoveryState} · ${t.recoveryTimer.toFixed(1)}s · tries ${t.stuckAttempts}</b>
          <span>timers</span><b>S ${t.stuckTimer.toFixed(1)} P ${t.progressTimer.toFixed(1)} U ${t.unstickTimer.toFixed(1)}</b>
        </div>
      </div>
    `;
  }
}

function surfaceName(wheels: Array<{ surface: string }>): string {
  if (wheels.length === 0) return 'airborne';
  const counts = new Map<string, number>();
  for (const w of wheels) counts.set(w.surface, (counts.get(w.surface) ?? 0) + 1);
  let best = wheels[0].surface;
  let bestCount = 0;
  for (const [surface, count] of counts) {
    if (count > bestCount) {
      best = surface;
      bestCount = count;
    }
  }
  return SURFACE_LABELS[best] ?? best;
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}
