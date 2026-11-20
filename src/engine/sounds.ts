import type { ClickVoice, SoundId } from './types';

/**
 * Click voices synthesized from oscillators and noise. No audio files.
 * Every voice is a pure "schedule at time t" function; nothing here touches timers.
 */

export const SOUNDS: { id: SoundId; name: string }[] = [
  { id: 'blip', name: 'Blip' },
  { id: 'wood', name: 'Wood' },
  { id: 'tick', name: 'Tick' },
  { id: 'bell', name: 'Bell' },
  { id: 'shaker', name: 'Shaker' },
  { id: 'thump', name: 'Thump' },
  { id: 'beep', name: 'Beep' },
  { id: 'tone', name: 'Tone' },
];

/** Base pitch of the speaker-mode tone. With the voice multipliers every click stays above 2.5 kHz. */
export const TONE_BASE_HZ = 3000;

interface VoiceShape {
  gain: number;
  /** Pitch multiplier relative to the sound's base frequency. */
  pitch: number;
}

const SHAPES: Record<ClickVoice, VoiceShape> = {
  accent: { gain: 1, pitch: 1.5 },
  normal: { gain: 0.72, pitch: 1 },
  soft: { gain: 0.36, pitch: 1 },
  sub: { gain: 0.3, pitch: 0.84 },
  countIn: { gain: 0.6, pitch: 1.26 },
  countInAccent: { gain: 0.9, pitch: 1.89 },
};

interface Ctx {
  ac: BaseAudioContext;
  out: AudioNode;
  t: number;
  gain: number;
  pitch: number;
  noise: AudioBuffer;
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

function noiseBuffer(ac: BaseAudioContext): AudioBuffer {
  let buf = noiseCache.get(ac);
  if (!buf) {
    buf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.5), ac.sampleRate);
    const data = buf.getChannelData(0);
    // Deterministic PRNG so every click sounds identical.
    let seed = 0x2f6b1a3d;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = seed / 0x80000000 - 1;
    }
    noiseCache.set(ac, buf);
  }
  return buf;
}

/** Gain node with a fast attack and exponential decay starting at t. */
function envelope(c: Ctx, peak: number, decay: number, attack = 0.001): GainNode {
  const g = c.ac.createGain();
  // A GainNode starts at 1 until its first event; if the source starts a fraction of a
  // sample before c.t, that one sample would pass at full volume as a broadband spike.
  g.gain.value = 0;
  g.gain.setValueAtTime(0.0001, c.t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), c.t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, c.t + attack + decay);
  g.connect(c.out);
  return g;
}

function osc(c: Ctx, type: OscillatorType, freq: number, dest: AudioNode, dur: number): OscillatorNode {
  const o = c.ac.createOscillator();
  o.type = type;
  // Set the value directly as well: with only an event at c.t, Chrome renders the very
  // first instant at the default 440 Hz, a low-frequency blip the speaker-mode meter hears.
  o.frequency.value = freq;
  o.frequency.setValueAtTime(freq, c.t);
  o.connect(dest);
  o.start(c.t);
  o.stop(c.t + dur);
  o.onended = () => o.disconnect();
  return o;
}

function noise(c: Ctx, dest: AudioNode, dur: number): AudioBufferSourceNode {
  const n = c.ac.createBufferSource();
  n.buffer = c.noise;
  n.connect(dest);
  n.start(c.t);
  n.stop(c.t + dur);
  n.onended = () => n.disconnect();
  return n;
}

function filter(c: Ctx, type: BiquadFilterType, freq: number, q: number, dest: AudioNode): BiquadFilterNode {
  const f = c.ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq; // same reason as in osc(): no default values before c.t
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, c.t);
  f.Q.setValueAtTime(q, c.t);
  f.connect(dest);
  return f;
}

const VOICES: Record<SoundId, (c: Ctx) => void> = {
  blip(c) {
    const e = envelope(c, 0.6 * c.gain, 0.05);
    osc(c, 'sine', 1000 * c.pitch, e, 0.08);
  },
  wood(c) {
    const e = envelope(c, 0.7 * c.gain, 0.045);
    osc(c, 'triangle', 820 * c.pitch, e, 0.07);
    const n = envelope(c, 0.35 * c.gain, 0.012);
    noise(c, filter(c, 'bandpass', 2400 * c.pitch, 3, n), 0.03);
  },
  tick(c) {
    const e = envelope(c, 0.9 * c.gain, 0.014);
    noise(c, filter(c, 'highpass', 3500 * c.pitch, 0.7, e), 0.03);
    const s = envelope(c, 0.25 * c.gain, 0.01);
    osc(c, 'sine', 3000 * c.pitch, s, 0.03);
  },
  bell(c) {
    const e = envelope(c, 0.28 * c.gain, 0.22);
    const bp = filter(c, 'bandpass', 2000 * c.pitch, 1.2, e);
    osc(c, 'square', 560 * c.pitch, bp, 0.3);
    osc(c, 'square', 835 * c.pitch, bp, 0.3);
  },
  shaker(c) {
    const e = envelope(c, 0.8 * c.gain, 0.06, 0.006);
    noise(c, filter(c, 'bandpass', 6500 * c.pitch, 1.4, e), 0.09);
  },
  thump(c) {
    const e = envelope(c, 0.95 * c.gain, 0.14);
    const o = osc(c, 'sine', 170 * c.pitch, e, 0.2);
    o.frequency.exponentialRampToValueAtTime(48, c.t + 0.09);
    const n = envelope(c, 0.15 * c.gain, 0.006);
    noise(c, filter(c, 'lowpass', 3000, 0.7, n), 0.02);
  },
  /**
   * Pure sine with a 4 ms raised-cosine fade-in: almost no energy below 2.5 kHz, so the
   * accuracy meter's low-band detector (speaker mode) does not mistake it for a hit.
   */
  tone(c) {
    const g = c.ac.createGain();
    g.gain.value = 0; // silent before c.t too (see envelope())
    const peak = 0.5 * c.gain;
    const curve = new Float32Array(16).map((_, i) => peak * 0.5 * (1 - Math.cos((Math.PI * i) / 15)));
    curve[0] = 0;
    g.gain.setValueAtTime(0, c.t);
    g.gain.setValueCurveAtTime(curve, c.t, 0.004);
    g.gain.setTargetAtTime(0, c.t + 0.004, 0.018);
    g.connect(c.out);
    const o = osc(c, 'sine', TONE_BASE_HZ * c.pitch, g, 0.12);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  },
  beep(c) {
    const e = envelope(c, 0.22 * c.gain, 0.03, 0.002);
    osc(c, 'square', 880 * c.pitch, filter(c, 'lowpass', 4000, 0.7, e), 0.06);
  },
};

/** Schedule one click of `sound` at AudioContext time `t`. */
export function playClick(
  ac: BaseAudioContext,
  out: AudioNode,
  sound: SoundId,
  voice: ClickVoice,
  t: number,
): void {
  const shape = SHAPES[voice];
  (VOICES[sound] ?? VOICES.blip)({ ac, out, t, gain: shape.gain, pitch: shape.pitch, noise: noiseBuffer(ac) });
}

export const isSoundId = (x: unknown): x is SoundId => SOUNDS.some((s) => s.id === x);
