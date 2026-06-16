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
    const speedT = clamp01(speed / 24);
    const throttle = snap.controls.throttle;
    this.engine.playbackRate = 0.72 + speedT * 0.65 + throttle * 0.18;
    this.engine.volume = this.sfxVolume() * (0.12 + speedT * 0.36 + throttle * 0.08);

    if (throttle > 0.7 && speed > 4 && this.accelCooldown <= 0) {
      this.accelCooldown = 3.5;
      this.engineAccel.volume = this.sfxVolume() * 0.2;
      void play(this.engineAccel);
    }

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
}

function audio(src: string, loop: boolean): HTMLAudioElement {
  const el = new Audio(src);
  el.loop = loop;
  el.crossOrigin = 'anonymous';
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
