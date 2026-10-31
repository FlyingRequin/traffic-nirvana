import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

class SoundManager {
  private ctx: AudioContext | null = null;
  public enabled: boolean = true;
  private audioUnlocked: boolean = false;
  
  // Melodic scale for road drawing
  private drawScale: number[] = [
    261.63, 293.66, 329.63, 392.00, 440.00, // C4, D4, E4, G4, A4
    523.25, 587.33, 659.25, 783.99, 880.00, // C5, D5, E5, G5, A5
    1046.50, 1174.66, 1318.51, 1567.98       // C6, D6, E6, G6
  ];
  private currentDrawStep: number = 0;
  private lastWarningTick: number = 0;

  // Ambient generative music
  private musicInterval: number | null = null;
  private musicActive: boolean = false;
  private ambientChords: number[][] = [
    [130.81, 196.00, 261.63, 329.63], // C major (C3, G3, C4, E4)
    [146.83, 220.00, 261.63, 349.23], // Dm7 (D3, A3, C4, F4)
    [164.81, 196.00, 246.94, 329.63], // Em7 (E3, G3, B3, E4)
    [174.61, 261.63, 329.63, 392.00], // Fmaj7 (F3, C4, E4, G4)
    [196.00, 293.66, 329.63, 392.00], // G6 (G3, D4, E4, G4)
    [220.00, 261.63, 329.63, 440.00]  // Am7 (A3, C4, E4, A4)
  ];
  private currentChordIndex: number = 0;

  constructor() {
    if (typeof window !== 'undefined') {
      const unlock = () => this.unlockAudio();
      window.addEventListener('pointerdown', unlock, { passive: true });
      window.addEventListener('touchstart', unlock, { passive: true });
    }
  }

  public unlockAudio() {
    this.initCtx();
    if (this.ctx && !this.audioUnlocked) {
      // Play a silent 1-sample buffer to unlock iOS WKWebView / Safari Web Audio
      try {
        const buffer = this.ctx.createBuffer(1, 1, 22050);
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.ctx.destination);
        source.start(0);
        this.audioUnlocked = true;
      } catch {
        // Ignore if not ready
      }
    }
  }

  public triggerHaptic(style: 'light' | 'medium' | 'heavy' | 'error' = 'light') {
    try {
      if (style === 'error') {
        void Haptics.notification({ type: NotificationType.Error }).catch(() => {});
      } else {
        const map: Record<'light' | 'medium' | 'heavy', ImpactStyle> = {
          light: ImpactStyle.Light,
          medium: ImpactStyle.Medium,
          heavy: ImpactStyle.Heavy,
        };
        void Haptics.impact({ style: map[style] }).catch(() => {});
      }
    } catch {
      // Ignore on environments without Capacitor Haptics
    }
  }

  private initCtx() {
    if (!this.ctx) {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtxClass) {
        this.ctx = new AudioCtxClass();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    if (!this.musicActive && this.enabled) {
      this.startAmbientMusic();
    }
  }

  public startAmbientMusic() {
    if (this.musicInterval) return;
    this.musicActive = true;
    
    // Play an ambient generative chord swell every 5.5 seconds
    this.musicInterval = window.setInterval(() => {
      if (!this.enabled || !this.ctx) return;
      this.playAmbientChord();
    }, 5500);
  }

  private playAmbientChord() {
    if (!this.ctx || !this.enabled) return;

    const chord = this.ambientChords[this.currentChordIndex % this.ambientChords.length];
    this.currentChordIndex = (this.currentChordIndex + Math.floor(Math.random() * 2 + 1)) % this.ambientChords.length;

    const now = this.ctx.currentTime;
    chord.forEach((freq, idx) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * (1 + (Math.random() - 0.5) * 0.003), now);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(650, now);

      // Long soft swell and fade (5.0s)
      const noteDelay = idx * 0.12;
      const startTime = now + noteDelay;
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.linearRampToValueAtTime(0.024, startTime + 1.8);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 4.8);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 5.0);
    });
  }

  /**
   * Called as the user drags and places consecutive road tiles.
   * Plays rising pentatonic notes for an ultra-satisfying tactile building feel!
   */
  public playDrawRoadStep() {
    this.triggerHaptic('light');
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const freq = this.drawScale[this.currentDrawStep % this.drawScale.length];
    this.currentDrawStep++;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.1);
  }

  public resetDrawStep() {
    this.currentDrawStep = 0;
  }

  public playEraseRoad() {
    this.triggerHaptic('light');
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(280, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.07);

    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.08);
  }

  public playDemolishQueued() {
    this.triggerHaptic('medium');
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.11);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.13);
  }

  public playDemolishPopped() {
    this.triggerHaptic('light');
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    // Satisfying bubble pop
    osc.type = 'sine';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(740, now + 0.045);

    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.06);
  }

  public playMotorwayPlacement() {
    this.triggerHaptic('medium');
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(440, now + 0.22);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, now);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.26);
  }

  public playPinSpawn() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(650, now);
    osc.frequency.exponentialRampToValueAtTime(950, now + 0.07);

    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.08);
  }

  private lastBellTime: number = 0;
  private bellToneIndex: number = 0;

  public playHarmonizedPinPickup(color: string = 'red', combo = 0) {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const chord = this.ambientChords[this.currentChordIndex % this.ambientChords.length];
    // Map color to scale degree from the active ambient chord swell:
    // Red -> Root note (chord[0] * 4)
    // Blue -> 3rd (chord[3] * 2 or chord[0] * 1.25 * 4)
    // Yellow -> 5th (chord[1] * 4)
    // Green -> 7th / 9th (chord[2] * 4)
    // Purple -> High octave (chord[0] * 8)
    let baseFreq = chord[0] * 4;
    if (color === 'red') {
      baseFreq = chord[0] * 4;
    } else if (color === 'blue') {
      baseFreq = (chord[3] || chord[0] * 1.25) * 2;
    } else if (color === 'yellow') {
      baseFreq = chord[1] * 4;
    } else if (color === 'green') {
      baseFreq = (chord[2] || chord[0] * 1.5) * 4;
    } else if (color === 'purple') {
      baseFreq = chord[0] * 8;
    }

    // Gentle upward pitch glint if multiple pins collected in quick succession
    const comboFactor = Math.pow(1.05946, Math.min(6, combo)); // 1 semitone per combo
    const freq = Math.min(2200, Math.max(300, baseFreq * comboFactor));

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);

    // Warm, lingering crystal chime decay
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.40);
  }

  public playPinPickup(color: string = 'red') {
    this.playHarmonizedPinPickup(color);
  }

  public playCrossingBell() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    if (now - this.lastBellTime < 0.44) return; // rate limit to ~2.2 Hz
    this.lastBellTime = now;

    // Authentic two-tone melodic railroad crossing bell (E6: 1318.5Hz and B5: 987.8Hz)
    const bellNotes = [1318.51, 987.77];
    const freq = bellNotes[this.bellToneIndex % bellNotes.length];
    this.bellToneIndex++;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);

    // Sharp metallic ring with pleasant high-register decay
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.30);
  }

  public playBlueprintDraft() {
    this.triggerHaptic('light');
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(540, now);
    osc.frequency.exponentialRampToValueAtTime(720, now + 0.04);

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.06);
  }

  public playBlueprintCommit() {
    this.triggerHaptic('heavy');
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    // Rapid ascending arpeggio fanfare in current chord (Root, 3rd, 5th, Octave)
    const chord = this.ambientChords[this.currentChordIndex % this.ambientChords.length];
    const notes = [chord[0] * 2, (chord[3] || chord[0] * 1.25) * 2, chord[1] * 2, chord[0] * 4];

    notes.forEach((freq, idx) => {
      if (!this.ctx) return;
      const t = now + idx * 0.055;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0.14, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(t);
      osc.stop(t + 0.24);
    });
  }

  public playBlueprintDiscard() {
    this.triggerHaptic('light');
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(380, now);
    osc.frequency.exponentialRampToValueAtTime(160, now + 0.08);

    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.10);
  }

  public playWarningTick() {
    if (!this.enabled) return;
    const nowMs = performance.now();
    if (nowMs - this.lastWarningTick < 380) return;
    this.lastWarningTick = nowMs;

    this.initCtx();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.06);

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.07);
  }

  public playWeekComplete() {
    this.triggerHaptic('medium');
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const chords = [523.25, 659.25, 783.99, 1046.50];
    const now = this.ctx.currentTime;

    chords.forEach((f, i) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const noteTime = now + i * 0.07;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, noteTime);

      gain.gain.setValueAtTime(0.12, noteTime);
      gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.45);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(noteTime);
      osc.stop(noteTime + 0.48);
    });
  }

  public playGameOver() {
    this.triggerHaptic('error');
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const tones = [220, 196, 174.61, 146.83];
    const now = this.ctx.currentTime;

    tones.forEach((f, i) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const noteTime = now + i * 0.16;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, noteTime);

      gain.gain.setValueAtTime(0.14, noteTime);
      gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.7);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(noteTime);
      osc.stop(noteTime + 0.75);
    });
  }
}

export const sound = new SoundManager();
