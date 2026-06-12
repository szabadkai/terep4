/**
 * Input layer. The simulation only ever sees InputState — a plain data
 * object — so input devices can be swapped (gamepad, replay, AI) without
 * touching sim code.
 */

export interface InputState {
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** -1 (left) .. 1 (right) */
  steer: number;
  handbrake: boolean;
  /** Edge-triggered; the sim consumes it via takeReset(). */
  reset: boolean;
}

export class KeyboardInput {
  readonly state: InputState = {
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: false,
    reset: false,
  };

  private readonly down = new Set<string>();

  attach(target: Window): void {
    target.addEventListener('keydown', this.onKey);
    target.addEventListener('keyup', this.onKey);
    target.addEventListener('blur', this.onBlur);
  }

  detach(target: Window): void {
    target.removeEventListener('keydown', this.onKey);
    target.removeEventListener('keyup', this.onKey);
    target.removeEventListener('blur', this.onBlur);
  }

  /** Returns true once per reset keypress. */
  takeReset(): boolean {
    const r = this.state.reset;
    this.state.reset = false;
    return r;
  }

  private onKey = (e: KeyboardEvent): void => {
    const pressed = e.type === 'keydown';
    const code = e.code;
    if (HANDLED_CODES.has(code)) e.preventDefault();
    if (pressed) {
      if (code === 'KeyR' && !this.down.has(code)) this.state.reset = true;
      this.down.add(code);
    } else {
      this.down.delete(code);
    }
    this.refresh();
  };

  private onBlur = (): void => {
    this.down.clear();
    this.refresh();
  };

  private refresh(): void {
    const has = (c: string) => this.down.has(c);
    this.state.throttle = has('KeyW') || has('ArrowUp') ? 1 : 0;
    this.state.brake = has('KeyS') || has('ArrowDown') ? 1 : 0;
    const left = has('KeyA') || has('ArrowLeft') ? 1 : 0;
    const right = has('KeyD') || has('ArrowRight') ? 1 : 0;
    this.state.steer = right - left;
    this.state.handbrake = has('Space');
  }
}

const HANDLED_CODES = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyR',
]);
