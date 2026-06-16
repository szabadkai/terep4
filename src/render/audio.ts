import type { RaceState } from '../sim/race';
import type { VehicleSnapshot } from '../sim/snapshot';

const AUDIO_KEY = 'mud.audio';

export interface AudioSettings {
  master: number;
  music: number;
  sfx: number;
}

const DEFAULT_SETTINGS: AudioSettings = {
  master: 0.75,
  music: 0.45,
  sfx: 0.75,
};

const ASSETS = {
  music: '/audio/music.ogg',
  engineLoop: '/audio/engine-loop.ogg',
  engineStart: '/audio/engine-start.ogg',
  engineAccel: '/audio/engine-accel.ogg',
  checkpoint: '/audio/checkpoint-horn.ogg',
  mud: '/audio/mud.ogg',
  gravel: '/audio/gravel.ogg',
};

const GEAR_SPEEDS = [0, 7, 13.5, 20.5, 29, 40];

export function loadAudioSettings(): AudioSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(AUDIO_KEY) ?? '') as Partial<AudioSettings>;
    return {
      master: volumeOrDefault(parsed.master, DEFAULT_SETTINGS.master),
      music: volumeOrDefault(parsed.music, DEFAULT_SETTINGS.music),
      sfx: volumeOrDefault(parsed.sfx, DEFAULT_SETTINGS.sfx),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveAudioSettings(settings: AudioSettings): void {
  localStorage.setItem(AUDIO_KEY, JSON.stringify(settings));
}

export class GameAudio {
  readonly settings: AudioSettings = loadAudioSettings();

  private readonly music = audio(ASSETS.music, true);
  private readonly engine = audio(ASSETS.engineLoop, true);
  private readonly mud = audio(ASSETS.mud, true);
  private readonly gravel = audio(ASSETS.gravel, true);
  private readonly engineStart = audio(ASSETS.engineStart, false);
  private readonly engineAccel = audio(ASSETS.engineAccel, false);
  private readonly checkpoint = audio(ASSETS.checkpoint, false);
  private unlocked = false;
  private running = false;
  private previousCheckpoint = 0;
  private previousPhase: RaceState['phase'] = 'ready';
  private accelCooldown = 0;
  private previousThrottle = 0;
  private engineClock = 0;
  private engineRate = 0.78;
  private engineGain = 0;

  constructor() {
    this.music.preload = 'auto';
    this.engine.preload = 'auto';
    this.mud.preload = 'auto';
    this.gravel.preload = 'auto';
    this.applySettings();
  }

  setSettings(next: AudioSettings): void {
    this.settings.master = clamp01(next.master);
    this.settings.music = clamp01(next.music);
    this.settings.sfx = clamp01(next.sfx);
    saveAudioSettings(this.settings);
    this.applySettings();
  }

  start(): void {
    this.running = true;
    void this.unlock();
    void play(this.music);
    void play(this.engine);
    void play(this.mud);
    void play(this.gravel);
    if (this.previousPhase === 'ready') void play(this.engineStart);
    this.applySettings();
  }

  pause(): void {
    this.running = false;
    this.engine.volume = 0;
    this.mud.volume = 0;
    this.gravel.volume = 0;
    this.music.volume = this.musicVolume() * 0.4;
  }

  stop(): void {
    this.running = false;
    for (const el of [this.engine, this.mud, this.gravel]) {
      el.pause();
      el.currentTime = 0;
    }
    this.applySettings();
  }

  update(snap: VehicleSnapshot, race: RaceState, frameDt: number): void {
    this.accelCooldown = Math.max(0, this.accelCooldown - frameDt);
    if (race.phase === 'ready') {
      this.previousCheckpoint = race.current;
      this.previousPhase = race.phase;
    }
    if (race.current > this.previousCheckpoint) {
      this.playCheckpoint();
    }
    if (race.phase === 'finished' && this.previousPhase !== 'finished') {
      this.playCheckpoint();
    }
    this.previousCheckpoint = race.current;
    this.previousPhase = race.phase;

    if (!this.running) return;

    const speed = Math.max(0, snap.speedKmh / 3.6);
    const speedT = clamp01(speed / 28);
    const throttle = snap.controls.throttle;
    const grounded = snap.surface !== null;
    const badSurface = snap.surface === 'mud' || snap.surface === 'water';
    const roughSurface =
      badSurface || snap.surface === 'rock' || snap.surface === 'sand' || snap.surface === 'snow';
    const hillOrBogLoad =
      throttle * (1 - speedT) * (badSurface ? 1.15 : roughSurface ? 0.65 : 0.35);
    const strain = clamp01(hillOrBogLoad + (snap.sliding ? 0.18 : 0) + (!grounded ? 0.12 : 0));
    const rpm = this.engineRpm(speed, throttle, strain);
    this.engineClock += frameDt * (0.8 + rpm * 2.8);
    const flutter =
      Math.sin(this.engineClock * 9.7) * 0.018 + Math.sin(this.engineClock * 17.3) * 0.008;
    const targetRate = clamp(0.58 + rpm * 0.92 + strain * 0.12 + flutter, 0.54, 1.82);
    const targetGain =
      this.sfxVolume() *
      (0.1 + speedT * 0.24 + throttle * 0.19 + strain * 0.2 + (grounded ? 0 : 0.06));
    const mix = clamp01(frameDt * 8);
    this.engineRate += (targetRate - this.engineRate) * mix;
    this.engineGain += (targetGain - this.engineGain) * mix;
    this.engine.playbackRate = this.engineRate;
    this.engine.volume = this.engineGain;

    const throttleStab = throttle > 0.55 && this.previousThrottle <= 0.55;
    const loadedPull = throttle > 0.68 && speed > 2.5 && (strain > 0.42 || speedT > 0.35);
    if ((throttleStab || loadedPull) && this.accelCooldown <= 0) {
      this.accelCooldown = throttleStab ? 1.4 : 2.8;
      this.engineAccel.playbackRate = clamp(0.88 + rpm * 0.38 + strain * 0.18, 0.8, 1.35);
      this.engineAccel.volume = this.sfxVolume() * (0.12 + strain * 0.12 + throttle * 0.08);
      void play(this.engineAccel);
    }
    this.previousThrottle = throttle;

    const contact = snap.surface !== null && speed > 2.5 ? clamp01((speed - 2.5) / 18) : 0;
    const slip = snap.sliding ? 1.35 : 1;
    this.mud.volume =
      this.sfxVolume() *
      contact *
      slip *
      (snap.surface === 'mud' || snap.surface === 'water' ? 0.46 : 0);
    this.gravel.volume =
      this.sfxVolume() *
      contact *
      slip *
      (snap.surface === 'rock' || snap.surface === 'sand' || snap.surface === 'snow' ? 0.34 : 0);
  }

  private async unlock(): Promise<void> {
    if (this.unlocked) return;
    this.unlocked = true;
    for (const el of [this.music, this.engine, this.mud, this.gravel]) {
      el.volume = 0;
      try {
        await play(el);
      } catch {
        this.unlocked = false;
      }
    }
    this.applySettings();
  }

  private playCheckpoint(): void {
    this.checkpoint.volume = this.sfxVolume() * 0.42;
    this.checkpoint.currentTime = 0;
    void play(this.checkpoint);
  }

  private applySettings(): void {
    this.music.volume = this.musicVolume() * (this.running ? 1 : 0.4);
    this.engine.volume = this.running ? this.engine.volume : 0;
    this.mud.volume = this.running ? this.mud.volume : 0;
    this.gravel.volume = this.running ? this.gravel.volume : 0;
    for (const el of [this.engineStart, this.engineAccel, this.checkpoint]) {
      el.volume = this.sfxVolume();
    }
  }

  private musicVolume(): number {
    return this.settings.master * this.settings.music;
  }

  private sfxVolume(): number {
    return this.settings.master * this.settings.sfx;
  }

  private engineRpm(speed: number, throttle: number, strain: number): number {
    let gear = 0;
    while (gear < GEAR_SPEEDS.length - 2 && speed > GEAR_SPEEDS[gear + 1]) gear++;
    const low = GEAR_SPEEDS[gear];
    const high = GEAR_SPEEDS[gear + 1];
    const gearT = clamp01((speed - low) / Math.max(1, high - low));
    const rev = 0.18 + gearT * 0.62 + throttle * 0.22 + strain * 0.16;
    return clamp01(rev);
  }
}

function audio(src: string, loop: boolean): HTMLAudioElement {
  const el = new Audio(src);
  el.loop = loop;
  el.crossOrigin = 'anonymous';
  pitchWithPlaybackRate(el);
  return el;
}

async function play(el: HTMLAudioElement): Promise<void> {
  try {
    await el.play();
  } catch {
    // Autoplay policies reject until a gesture; the next start/update retries.
  }
}

function volumeOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp01(value) : fallback;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pitchWithPlaybackRate(el: HTMLAudioElement): void {
  el.preservesPitch = false;
  const vendorEl = el as HTMLAudioElement & {
    mozPreservesPitch?: boolean;
    webkitPreservesPitch?: boolean;
  };
  vendorEl.mozPreservesPitch = false;
  vendorEl.webkitPreservesPitch = false;
}
