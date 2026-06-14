/**
 * Fixed-timestep game loop. Physics updates run at a constant dt regardless
 * of display refresh rate; the render callback receives an interpolation
 * alpha in [0,1) describing how far between the last two sim states the
 * current frame falls.
 *
 * Driven by requestAnimationFrame while visible; falls back to a coarse
 * interval when the tab is hidden so the simulation (and race clock) keep
 * running instead of freezing.
 */

const HIDDEN_TICK_MS = 100;

export class FixedLoop {
  private accumulator = 0;
  private last = 0;
  private rafId = 0;
  private intervalId: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(
    private readonly dt: number,
    private readonly update: (dt: number) => void,
    private readonly render: (alpha: number, frameDt: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    document.addEventListener('visibilitychange', this.onVisibility);
    this.schedule();
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
    while (this.accumulator >= this.dt) {
      this.update(this.dt);
      this.accumulator -= this.dt;
    }

    this.render(this.accumulator / this.dt, frameDt);
  }
}
