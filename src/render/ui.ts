/**
 * Menu overlays: title/start screen, pause screen, finish banner, and best
 * time persistence. All DOM; talks back to the game only via the callbacks
 * handed to it.
 */

import { formatTime } from './hud';
import type { AudioSettings } from './audio';
import type { RaceState, Standing } from '../sim/race';

const BEST_KEY = 'mud.best';
const LEGACY_BEST_KEY = 'terep4.best';
type AudioSliderId = Exclude<keyof AudioSettings, 'muted'>;

export function loadBest(): number | null {
  const raw = localStorage.getItem(BEST_KEY) ?? localStorage.getItem(LEGACY_BEST_KEY);
  const v = raw === null ? NaN : Number(raw);
  return Number.isFinite(v) ? v : null;
}

function saveBest(seconds: number): void {
  localStorage.setItem(BEST_KEY, String(seconds));
}

export class GameUi {
  private readonly startEl: HTMLElement;
  private readonly countdownEl: HTMLElement;
  private readonly pauseEl: HTMLElement;
  private readonly finishEl: HTMLElement;
  private readonly locationEl: HTMLElement;
  private locationName: string | null = null;
  private locationTimer = 0;
  best: number | null = loadBest();

  constructor(
    container: HTMLElement,
    onConfirm: () => void,
    audioSettings: AudioSettings,
    onAudioSettings: (settings: AudioSettings) => void,
  ) {
    this.startEl = overlay(
      container,
      `
      <h1>MUD</h1>
      <p class="ui-tag">No roads. Low gear. Full send.</p>
      <div class="ui-controls">
        <span>W / S</span><span>throttle · brake / reverse</span>
        <span>A / D</span><span>steer</span>
        <span>Space</span><span>handbrake</span>
        <span>R</span><span>flip the car back up</span>
        <span>Esc</span><span>pause</span>
      </div>
      <p class="ui-hint">Beat the AI to every checkpoint (follow the arrow). Mud, snow and water are slippery — water is slow, not deadly.</p>
      <p class="ui-action">press ENTER or click to start</p>
    `,
    );
    this.pauseEl = overlay(
      container,
      `
      <h1>PAUSED</h1>
      <p class="ui-action">press ENTER or Esc to resume</p>
    `,
    );
    this.countdownEl = overlay(container, '<h1 class="ui-countdown">3</h1>');
    this.finishEl = overlay(container, '');
    this.locationEl = document.createElement('div');
    this.locationEl.className = 'location-toast';
    container.appendChild(this.locationEl);
    audioSettingsPanel(container, audioSettings, onAudioSettings);
    this.startEl.classList.add('visible');

    for (const el of [this.startEl, this.countdownEl, this.pauseEl, this.finishEl]) {
      el.addEventListener('click', onConfirm);
    }
  }

  hideStart(): void {
    this.startEl.classList.remove('visible');
  }

  setPaused(paused: boolean): void {
    this.pauseEl.classList.toggle('visible', paused);
  }

  updateCountdown(race: RaceState): void {
    const visible = race.phase === 'countdown';
    this.countdownEl.classList.toggle('visible', visible);
    if (!visible) return;
    const count = Math.max(1, Math.ceil(race.countdownRemaining));
    this.countdownEl.innerHTML = `
      <h1 class="ui-countdown">${count}</h1>
      <p class="ui-tag">hold steady</p>
    `;
  }

  showFinish(race: RaceState): void {
    const timeSec = race.finishTime ?? race.elapsed;
    const position = race.position;
    const isBest = this.best === null || timeSec < this.best;
    if (isBest) {
      this.best = timeSec;
      saveBest(timeSec);
    }
    const ordinal = ['1st', '2nd', '3rd', '4th', '5th', '6th'][position - 1] ?? `${position}th`;
    const placeNote =
      position === 1
        ? 'you won the race!'
        : `${ordinal} of ${race.total} · ${isBest ? 'new best!' : `best ${formatTime(this.best!)}`}`;
    this.finishEl.innerHTML = `
      <h1>${position === 1 ? 'WINNER' : 'FINISH'}</h1>
      <p class="ui-place">${ordinal}</p>
      <p class="ui-time">${formatTime(timeSec)}</p>
      <div class="ui-summary">
        <span>${race.count}/${race.count} checkpoints</span>
        <span>${formatTime(race.elapsed)} elapsed</span>
      </div>
      <div class="ui-results">
        ${race.standings.map((standing, index) => resultRow(standing, index, race.count)).join('')}
      </div>
      <p class="ui-tag">${placeNote}</p>
      <p class="ui-action">press ENTER for a new race</p>
    `;
    this.finishEl.classList.add('visible');
  }

  hideFinish(): void {
    this.finishEl.classList.remove('visible');
    this.countdownEl.classList.remove('visible');
  }

  updateLocation(name: string | null, dt: number, active: boolean): void {
    if (!active || name === null) {
      this.locationEl.classList.remove('visible');
      this.locationTimer = 0;
      this.locationName = null;
      return;
    }
    if (name !== this.locationName) {
      this.locationName = name;
      this.locationTimer = 2.4;
      this.locationEl.textContent = name;
      this.locationEl.classList.add('visible');
    } else if (this.locationTimer > 0) {
      this.locationTimer = Math.max(0, this.locationTimer - dt);
      this.locationEl.classList.toggle('visible', this.locationTimer > 0);
    }
  }
}

function audioSettingsPanel(
  container: HTMLElement,
  initial: AudioSettings,
  onChange: (settings: AudioSettings) => void,
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'audio-settings';
  el.innerHTML = `
    <button class="audio-settings-toggle" type="button" aria-label="Audio settings">AUDIO</button>
    <div class="audio-settings-menu">
      ${muteControl(initial.muted)}
      ${slider('master', 'Master', initial.master)}
      ${slider('music', 'Music', initial.music)}
      ${slider('sfx', 'SFX', initial.sfx)}
      ${slider('engine', 'Engine', initial.engine)}
    </div>
  `;
  const toggle = el.querySelector<HTMLButtonElement>('.audio-settings-toggle')!;
  const menu = el.querySelector<HTMLElement>('.audio-settings-menu')!;
  toggle.setAttribute('aria-expanded', 'false');
  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    const visible = menu.classList.toggle('visible');
    toggle.setAttribute('aria-expanded', String(visible));
  });
  menu.addEventListener('click', (event) => event.stopPropagation());
  const read = (): AudioSettings => ({
    muted: el.querySelector<HTMLInputElement>('[data-audio-muted]')?.checked ?? false,
    master: readSlider(el, 'master'),
    music: readSlider(el, 'music'),
    sfx: readSlider(el, 'sfx'),
    engine: readSlider(el, 'engine'),
  });
  for (const input of el.querySelectorAll<HTMLInputElement>('input[type="range"]')) {
    input.addEventListener('input', () => onChange(read()));
    input.addEventListener('change', () => {
      onChange(read());
      input.blur();
    });
    input.addEventListener('pointerup', () => input.blur());
  }
  const mute = el.querySelector<HTMLInputElement>('[data-audio-muted]')!;
  mute.addEventListener('change', () => {
    onChange(read());
    mute.blur();
  });
  mute.addEventListener('pointerup', () => mute.blur());
  menu.addEventListener('keydown', (event) => {
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyR'].includes(event.code)) {
      event.preventDefault();
      (event.target as HTMLElement | null)?.blur();
    }
  });
  container.appendChild(el);
  return el;
}

function muteControl(muted: boolean): string {
  return `
    <label class="audio-settings-check">
      <span>Mute</span>
      <input type="checkbox" ${muted ? 'checked' : ''} data-audio-muted />
    </label>
  `;
}

function slider(id: AudioSliderId, label: string, value: number): string {
  return `
    <label>
      <span>${label}</span>
      <input type="range" min="0" max="1" step="0.01" value="${value}" data-audio="${id}" />
    </label>
  `;
}

function readSlider(container: HTMLElement, id: AudioSliderId): number {
  return Number(container.querySelector<HTMLInputElement>(`[data-audio="${id}"]`)?.value ?? 0);
}

function overlay(container: HTMLElement, html: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'ui-overlay';
  el.innerHTML = html;
  container.appendChild(el);
  return el;
}

function resultRow(standing: Standing, index: number, checkpointCount: number): string {
  const time = standing.finished
    ? formatTime(standing.time ?? 0)
    : `CP ${Math.min(standing.progress, checkpointCount)}/${checkpointCount}`;
  return `
    <div class="ui-result${standing.isPlayer ? ' ui-result-you' : ''}">
      <span>${index + 1}</span>
      <b>${escapeHtml(standing.name)}</b>
      <span>${time}</span>
    </div>
  `;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
