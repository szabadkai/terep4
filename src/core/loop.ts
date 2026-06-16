/**
 * Fixed-timestep game loop. Physics updates run at a constant dt regardless
 * of display refresh rate; the render callback receives an interpolation
 * alpha in [0,1) describing how far between the last two sim states the
 * current frame falls.
 *
 * Driven by requestAnimationFrame while visible; falls back to a coarse
 * interval when the tab is hidden so the simulation (and race clock) keep
 * running instead of freezing. Rendering is demand-based: fixed updates
 * report whether anything changed, so static menu/pause screens do not burn
 * frames.
 */

const HIDDEN_TICK_MS = 100;

export interface FixedLoopOptions {
  maxRenderFps?: number;
}

export class FixedLoop {
  private accumulator = 0;
  private renderAccumulator = 0;
  private last = 0;
  private lastRender = 0;
  private rafId = 0;
  private intervalId: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private needsRender = true;

  constructor(
    private readonly dt: number,
    private readonly update: (dt: number) => boolean | void,
    private readonly render: (alpha: number, frameDt: number) => void,
    private readonly options: FixedLoopOptions = {},
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    document.addEventListener('visibilitychange', this.onVisibility);
    this.schedule();
  }

  requestRender(): void {
    this.needsRender = true;
  }

  stop(): void {
    this.running = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    cancelAnimationFrame(this.rafId);
    clearInterval(this.intervalId);
    this.intervalId = undefined;
  }

  private schedule(): void {
    cancelAnimationFrame(this.rafId);
    clearInterval(this.intervalId);
    this.intervalId = undefined;
    if (document.hidden) {
      this.intervalId = setInterval(() => this.tick(performance.now()), HIDDEN_TICK_MS);
    } else {
      this.rafId = requestAnimationFrame(this.frame);
    }
  }

  private onVisibility = (): void => {
    if (!this.running) return;
    this.last = performance.now();
    this.schedule();
  };

  private frame = (now: number): void => {
    if (!this.running) return;
    this.tick(now);
    this.rafId = requestAnimationFrame(this.frame);
  };

  private tick(now: number): void {
    let frameDt = (now - this.last) / 1000;
    this.last = now;
    // Clamp long stalls (tab switches, debugger) so we don't spiral.
    if (frameDt > 0.25) frameDt = 0.25;

    this.accumulator += frameDt;
    this.renderAccumulator += frameDt;
    while (this.accumulator >= this.dt) {
      if (this.update(this.dt) !== false) this.needsRender = true;
      this.accumulator -= this.dt;
    }

    if (document.hidden || !this.needsRender) return;
    const minRenderInterval = this.options.maxRenderFps ? 1000 / this.options.maxRenderFps : 0;
    if (minRenderInterval > 0 && now - this.lastRender < minRenderInterval) return;

    this.lastRender = now;
    this.needsRender = false;
    const renderDt = this.renderAccumulator;
    this.renderAccumulator = 0;
    this.render(this.accumulator / this.dt, renderDt);
  }
}
