/**
 * Minimal DOM HUD: speed, current surface, slide indicator, controls help.
 */

import type { VehicleSnapshot } from '../sim/snapshot';

const SURFACE_LABELS: Record<string, string> = {
  grass: 'Grass',
  rock: 'Rock',
  mud: 'Mud',
  snow: 'Snow',
  water: 'Water',
};

export class Hud {
  private readonly speedEl: HTMLElement;
  private readonly surfaceEl: HTMLElement;
  private readonly slideEl: HTMLElement;

  constructor(container: HTMLElement) {
    const panel = document.createElement('div');
    panel.className = 'hud-panel';
    panel.innerHTML = `
      <div class="hud-speed"><span data-speed>0</span><small> km/h</small></div>
      <div class="hud-row"><span data-surface>—</span><span data-slide class="hud-slide">SLIDE</span></div>
    `;
    container.appendChild(panel);

    const help = document.createElement('div');
    help.className = 'hud-help';
    help.textContent = 'W/S throttle & brake · A/D steer · Space handbrake · R reset';
    container.appendChild(help);

    this.speedEl = panel.querySelector('[data-speed]')!;
    this.surfaceEl = panel.querySelector('[data-surface]')!;
    this.slideEl = panel.querySelector('[data-slide]')!;
  }

  update(snap: VehicleSnapshot): void {
    this.speedEl.textContent = String(Math.round(snap.speedKmh));
    this.surfaceEl.textContent = snap.surface ? SURFACE_LABELS[snap.surface] : 'Airborne';
    this.slideEl.style.visibility = snap.sliding ? 'visible' : 'hidden';
  }
}
