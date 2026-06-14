/**
 * In-game DOM HUD: speed and surface on the left, race timer / checkpoint
 * counter / direction arrow up top. Pure consumer of sim state.
 */

import type { VehicleSnapshot } from '../sim/snapshot';
import type { RaceState } from '../sim/race';

const SURFACE_LABELS: Record<string, string> = {
  grass: 'Grass',
  rock: 'Rock',
  mud: 'Mud',
  sand: 'Sand',
  snow: 'Snow',
  water: 'Water',
};

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

export class Hud {
  private readonly speedEl: HTMLElement;
  private readonly surfaceEl: HTMLElement;
  private readonly slideEl: HTMLElement;
  private readonly timeEl: HTMLElement;
  private readonly cpEl: HTMLElement;
  private readonly arrowEl: HTMLElement;
  private readonly bestEl: HTMLElement;
  private readonly posEl: HTMLElement;
  private readonly standingsEl: HTMLElement;

  constructor(container: HTMLElement, bestTime: number | null) {
    const panel = document.createElement('div');
    panel.className = 'hud-panel';
    panel.innerHTML = `
      <div class="hud-speed"><span data-speed>0</span><small> km/h</small></div>
      <div class="hud-row"><span data-surface>—</span><span data-slide class="hud-slide">SLIDE</span></div>
    `;
    container.appendChild(panel);

    const race = document.createElement('div');
    race.className = 'hud-race';
    race.innerHTML = `
      <div class="hud-arrow" data-arrow>
        <svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true">
          <path d="M12 1 L20 13 L14 13 L14 23 L10 23 L10 13 L4 13 Z"
            fill="currentColor" stroke="rgba(0,0,0,0.35)" stroke-width="0.8"
            stroke-linejoin="round" />
        </svg>
      </div>
      <div>
        <div class="hud-time" data-time>0:00.0</div>
        <div class="hud-cp"><span data-cp>CP 1/8</span> · <span data-best>no best yet</span></div>
      </div>
      <div class="hud-pos" data-pos>1<small>st</small></div>
    `;
    container.appendChild(race);

    const standings = document.createElement('div');
    standings.className = 'hud-standings';
    standings.dataset.standings = '';
    container.appendChild(standings);

    const help = document.createElement('div');
    help.className = 'hud-help';
    help.textContent = 'W/S throttle & brake · A/D steer · Space handbrake · R reset · Esc pause';
    container.appendChild(help);

    this.speedEl = panel.querySelector('[data-speed]')!;
    this.surfaceEl = panel.querySelector('[data-surface]')!;
    this.slideEl = panel.querySelector('[data-slide]')!;
    this.timeEl = race.querySelector('[data-time]')!;
    this.cpEl = race.querySelector('[data-cp]')!;
    this.arrowEl = race.querySelector('[data-arrow]')!;
    this.bestEl = race.querySelector('[data-best]')!;
    this.posEl = race.querySelector('[data-pos]')!;
    this.standingsEl = standings;
    this.setBest(bestTime);
  }

  setBest(bestTime: number | null): void {
    this.bestEl.textContent = bestTime === null ? 'no best yet' : `best ${formatTime(bestTime)}`;
  }

  update(snap: VehicleSnapshot, race: RaceState, carYaw: number): void {
    this.speedEl.textContent = String(Math.round(snap.speedKmh));
    this.surfaceEl.textContent = snap.surface ? SURFACE_LABELS[snap.surface] : 'Airborne';
    this.slideEl.style.visibility = snap.sliding ? 'visible' : 'hidden';

    this.timeEl.textContent = formatTime(race.finishTime ?? race.elapsed);
    if (race.next) {
      const dx = race.next.x - snap.pos.x;
      const dz = race.next.z - snap.pos.z;
      const bearing = Math.atan2(dx, dz);
      const rel = bearing - carYaw;
      this.arrowEl.style.transform = `rotate(${(-rel * 180) / Math.PI}deg)`;
      this.arrowEl.style.visibility = 'visible';
      this.cpEl.textContent = `CP ${race.current + 1}/${race.count} · ${Math.round(Math.hypot(dx, dz))}m`;
    } else {
      this.arrowEl.style.visibility = 'hidden';
      this.cpEl.textContent = race.phase === 'finished' ? 'FINISHED' : `CP -/${race.count}`;
    }

    this.updatePosition(race);
    this.updateStandings(race);
  }

  private updatePosition(race: RaceState): void {
    const ord = ORDINALS[race.position - 1] ?? `${race.position}th`;
    this.posEl.innerHTML = `${race.position}<small>${ord.slice(-2)}</small>`;
    this.posEl.classList.toggle('hud-pos-lead', race.position === 1);
  }

  private updateStandings(race: RaceState): void {
    this.standingsEl.innerHTML = race.standings
      .map((s, i) => {
        const swatch =
          s.color === null
            ? '<span class="hud-sw hud-sw-you"></span>'
            : `<span class="hud-sw" style="background:#${s.color.toString(16).padStart(6, '0')}"></span>`;
        const detail = s.finished
          ? formatTime(s.time ?? 0)
          : `CP ${Math.min(s.progress + 1, race.count)}`;
        return `<div class="hud-stand${s.isPlayer ? ' hud-stand-you' : ''}">
          <span class="hud-rank">${i + 1}</span>${swatch}
          <span class="hud-name">${s.name}</span>
          <span class="hud-detail">${detail}</span>
        </div>`;
      })
      .join('');
  }
}
