/**
 * Menu overlays: title/start screen, pause screen, finish banner, and best
 * time persistence. All DOM; talks back to the game only via the callbacks
 * handed to it.
 */

import { formatTime } from './hud';

const BEST_KEY = 'terep4.best';

export function loadBest(): number | null {
  const raw = localStorage.getItem(BEST_KEY);
  const v = raw === null ? NaN : Number(raw);
  return Number.isFinite(v) ? v : null;
}

function saveBest(seconds: number): void {
  localStorage.setItem(BEST_KEY, String(seconds));
}

export class GameUi {
  private readonly startEl: HTMLElement;
  private readonly pauseEl: HTMLElement;
  private readonly finishEl: HTMLElement;
  best: number | null = loadBest();

  constructor(container: HTMLElement, onConfirm: () => void) {
    this.startEl = overlay(
      container,
      `
      <h1>TEREP4</h1>
      <p class="ui-tag">off-road checkpoint race</p>
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
    this.finishEl = overlay(container, '');
    this.startEl.classList.add('visible');

    for (const el of [this.startEl, this.pauseEl, this.finishEl]) {
      el.addEventListener('click', onConfirm);
    }
  }

  hideStart(): void {
    this.startEl.classList.remove('visible');
  }

  setPaused(paused: boolean): void {
    this.pauseEl.classList.toggle('visible', paused);
  }

  /** `position`/`total` give the player's finishing place against the AI. */
  showFinish(timeSec: number, position: number, total: number): void {
    const isBest = this.best === null || timeSec < this.best;
    if (isBest) {
      this.best = timeSec;
      saveBest(timeSec);
    }
    const ordinal = ['1st', '2nd', '3rd', '4th', '5th', '6th'][position - 1] ?? `${position}th`;
    const placeNote =
      position === 1
        ? 'you won the race!'
        : `${ordinal} of ${total} · ${isBest ? 'new best!' : `best ${formatTime(this.best!)}`}`;
    this.finishEl.innerHTML = `
      <h1>${position === 1 ? 'WINNER' : 'FINISH'}</h1>
      <p class="ui-place">${ordinal}</p>
      <p class="ui-time">${formatTime(timeSec)}</p>
      <p class="ui-tag">${placeNote}</p>
      <p class="ui-action">press ENTER for a new race</p>
    `;
    this.finishEl.classList.add('visible');
  }

  hideFinish(): void {
    this.finishEl.classList.remove('visible');
  }
}

function overlay(container: HTMLElement, html: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'ui-overlay';
  el.innerHTML = html;
  container.appendChild(el);
  return el;
}
