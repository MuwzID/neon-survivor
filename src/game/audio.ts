import { GameSettings } from './storage';

export type SfxType =
  | 'shoot'
  | 'hit'
  | 'kill'
  | 'explosion'
  | 'pickup'
  | 'levelup'
  | 'dash'
  | 'playerHurt'
  | 'bossSpawn'
  | 'telegraph'
  | 'uiClick';

const MAX_CONCURRENT_VOICES = 14;

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private activeVoices = 0;
  private settings: GameSettings;
  private musicPlaying = false;
  private musicInterval: number | null = null;
  private stepIndex = 0;
  private currentWave = 1;

  constructor(initialSettings: GameSettings) {
    this.settings = { ...initialSettings };
  }

  public unlock(): void {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();

      this.sfxGain.connect(this.masterGain);
      this.musicGain.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);

      this.createNoiseBuffer();
      this.applySettings(this.settings);
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  private createNoiseBuffer(): void {
    if (!this.ctx) return;
    const length = this.ctx.sampleRate * 0.5;
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
  }

  public applySettings(settings: GameSettings): void {
    this.settings = { ...settings };
    if (!this.ctx || !this.masterGain || !this.sfxGain || !this.musicGain) return;
    const now = this.ctx.currentTime;
    this.masterGain.gain.setTargetAtTime(settings.muted ? 0 : 1, now, 0.02);
    this.sfxGain.gain.setTargetAtTime(settings.sfxVolume, now, 0.02);
    this.musicGain.gain.setTargetAtTime(settings.musicVolume * 0.35, now, 0.04);
  }

  public setWaveIntensity(wave: number): void {
    this.currentWave = Math.max(1, wave);
  }

  public startMusic(): void {
    this.unlock();
    if (this.musicPlaying) return;
    this.musicPlaying = true;
    this.stepIndex = 0;

    // 130 BPM 16th-note synthwave step sequencer (~115ms per step)
    this.musicInterval = window.setInterval(() => {
      this.tickMusicStep();
    }, 115);
  }

  public stopMusic(): void {
    this.musicPlaying = false;
    if (this.musicInterval !== null) {
      window.clearInterval(this.musicInterval);
      this.musicInterval = null;
    }
  }

  private tickMusicStep(): void {
    if (!this.ctx || !this.musicGain || this.settings.muted || this.settings.musicVolume <= 0.01) {
      return;
    }
    if (this.ctx.state !== 'running') return;

    const now = this.ctx.currentTime;
    const step = this.stepIndex % 16;
    const bar = Math.floor(this.stepIndex / 16) % 4;
    this.stepIndex++;

    // D minor / F major / Bb major / A7 synthwave progression
    const rootNotes = [73.42, 87.31, 58.27, 55.0]; // D2, F2, Bb1, A1
    const root = rootNotes[bar];

    // Driving bass arpeggio on every 16th step
    const octaveMult = step % 2 === 0 ? 1 : 2;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const env = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(root * octaveMult, now);

    filter.type = 'lowpass';
    const intensityCutoff = Math.min(1800, 480 + this.currentWave * 90 + (step % 4 === 0 ? 350 : 0));
    filter.frequency.setValueAtTime(intensityCutoff, now);
    filter.Q.setValueAtTime(4.0, now);

    env.gain.setValueAtTime(0.001, now);
    env.gain.linearRampToValueAtTime(0.28, now + 0.01);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    osc.connect(filter);
    filter.connect(env);
    env.connect(this.musicGain);

    osc.start(now);
    osc.stop(now + 0.105);

    // Kick thump on beats 0, 4, 8, 12
    if (step % 4 === 0) {
      const kickOsc = this.ctx.createOscillator();
      const kickGain = this.ctx.createGain();
      kickOsc.type = 'sine';
      kickOsc.frequency.setValueAtTime(125, now);
      kickOsc.frequency.exponentialRampToValueAtTime(34, now + 0.09);

      kickGain.gain.setValueAtTime(0.45, now);
      kickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

      kickOsc.connect(kickGain);
      kickGain.connect(this.musicGain);
      kickOsc.start(now);
      kickOsc.stop(now + 0.11);
    }

    // High synth lead pulse on higher waves
    if (this.currentWave >= 2 && (step === 2 || step === 6 || step === 10 || step === 14)) {
      const scaleRatios = [4, 4.75, 5.33, 6, 7.12];
      const ratio = scaleRatios[(step + bar) % scaleRatios.length];
      const leadOsc = this.ctx.createOscillator();
      const leadGain = this.ctx.createGain();
      leadOsc.type = 'triangle';
      leadOsc.frequency.setValueAtTime(root * ratio, now);

      leadGain.gain.setValueAtTime(0.001, now);
      leadGain.gain.linearRampToValueAtTime(0.12, now + 0.015);
      leadGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

      leadOsc.connect(leadGain);
      leadGain.connect(this.musicGain);
      leadOsc.start(now);
      leadOsc.stop(now + 0.17);
    }
  }

  public playSfx(
    type: SfxType,
    relX = 0,
    relZ = 0
  ): void {
    if (this.settings.muted || this.settings.sfxVolume <= 0.01) return;
    if (!this.ctx || !this.sfxGain) {
      this.unlock();
      if (!this.ctx || !this.sfxGain) return;
    }
    if (this.ctx.state !== 'running') return;
    if (this.activeVoices >= MAX_CONCURRENT_VOICES && type !== 'playerHurt' && type !== 'levelup') {
      return;
    }

    const now = this.ctx.currentTime;
    const dist = Math.sqrt(relX * relX + relZ * relZ);
    const distGain = Math.max(0.15, Math.min(1.0, 1.0 - dist / 48.0));
    const panVal = Math.max(-0.85, Math.min(0.85, relX / 22.0));

    const panner = this.ctx.createStereoPanner();
    panner.pan.setValueAtTime(panVal, now);
    panner.connect(this.sfxGain);

    this.activeVoices++;
    const releaseVoice = (delayMs: number) => {
      window.setTimeout(() => {
        this.activeVoices = Math.max(0, this.activeVoices - 1);
      }, delayMs);
    };

    const pitchJitter = 1 + (Math.random() - 0.5) * 0.14;

    switch (type) {
      case 'shoot': {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(640 * pitchJitter, now);
        osc.frequency.exponentialRampToValueAtTime(140, now + 0.075);

        gain.gain.setValueAtTime(0.22 * distGain, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

        osc.connect(gain);
        gain.connect(panner);
        osc.start(now);
        osc.stop(now + 0.085);
        releaseVoice(90);
        break;
      }

      case 'hit': {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(310 * pitchJitter, now);
        osc.frequency.exponentialRampToValueAtTime(95, now + 0.055);

        gain.gain.setValueAtTime(0.2 * distGain, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

        osc.connect(gain);
        gain.connect(panner);
        osc.start(now);
        osc.stop(now + 0.065);
        releaseVoice(70);
        break;
      }

      case 'kill':
      case 'explosion': {
        const dur = type === 'explosion' ? 0.32 : 0.18;
        if (this.noiseBuffer) {
          const src = this.ctx.createBufferSource();
          src.buffer = this.noiseBuffer;
          const filter = this.ctx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(type === 'explosion' ? 950 : 1300, now);
          filter.frequency.exponentialRampToValueAtTime(90, now + dur);

          const gain = this.ctx.createGain();
          gain.gain.setValueAtTime((type === 'explosion' ? 0.45 : 0.28) * distGain, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

          src.connect(filter);
          filter.connect(gain);
          gain.connect(panner);
          src.start(now);
          src.stop(now + dur);
        }
        releaseVoice(dur * 1000);
        break;
      }

      case 'pickup': {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(520 * pitchJitter, now);
        osc.frequency.exponentialRampToValueAtTime(1040 * pitchJitter, now + 0.09);

        gain.gain.setValueAtTime(0.18 * distGain, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.095);

        osc.connect(gain);
        gain.connect(panner);
        osc.start(now);
        osc.stop(now + 0.1);
        releaseVoice(105);
        break;
      }

      case 'dash': {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(760, now + 0.14);

        gain.gain.setValueAtTime(0.28, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

        osc.connect(gain);
        gain.connect(panner);
        osc.start(now);
        osc.stop(now + 0.16);
        releaseVoice(165);
        break;
      }

      case 'playerHurt': {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(175, now);
        osc.frequency.linearRampToValueAtTime(62, now + 0.24);

        gain.gain.setValueAtTime(0.45, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

        osc.connect(gain);
        gain.connect(panner);
        osc.start(now);
        osc.stop(now + 0.26);
        releaseVoice(270);
        break;
      }

      case 'levelup': {
        const notes = [440, 554.37, 659.25, 880];
        notes.forEach((freq, idx) => {
          if (!this.ctx) return;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'triangle';
          const t = now + idx * 0.065;
          osc.frequency.setValueAtTime(freq, t);
          gain.gain.setValueAtTime(0.001, t);
          gain.gain.linearRampToValueAtTime(0.28, t + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
          osc.connect(gain);
          gain.connect(panner);
          osc.start(t);
          osc.stop(t + 0.23);
        });
        releaseVoice(450);
        break;
      }

      case 'bossSpawn': {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(95, now);
        osc.frequency.linearRampToValueAtTime(52, now + 0.65);

        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.68);

        osc.connect(gain);
        gain.connect(panner);
        osc.start(now);
        osc.stop(now + 0.7);
        releaseVoice(700);
        break;
      }

      case 'telegraph': {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(340, now);
        osc.frequency.exponentialRampToValueAtTime(680, now + 0.22);

        gain.gain.setValueAtTime(0.18 * distGain, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

        osc.connect(gain);
        gain.connect(panner);
        osc.start(now);
        osc.stop(now + 0.25);
        releaseVoice(260);
        break;
      }

      case 'uiClick': {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(780, now);
        osc.frequency.exponentialRampToValueAtTime(1180, now + 0.035);

        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

        osc.connect(gain);
        gain.connect(panner);
        osc.start(now);
        osc.stop(now + 0.045);
        releaseVoice(50);
        break;
      }
    }
  }

  public dispose(): void {
    this.stopMusic();
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}
