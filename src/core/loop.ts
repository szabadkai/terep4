/**
 * Fixed-timestep game loop. Physics updates run at a constant dt regardless
 * of display refresh rate; the render callback receives an interpolation
 * alpha in [0,1) describing how far between the last two sim states the
 * current frame falls.
 */
export class FixedLoop {
  private accumulator = 0;
  private last = 0;
  private rafId = 0;
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
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private tick = (now: number): void => {
    if (!this.running) return;
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
    this.rafId = requestAnimationFrame(this.tick);
  };
}
