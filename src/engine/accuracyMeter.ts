import { PROBE_GAPS, summarizeCalibration, type CalibrationResult } from './accuracy';
import type { DetectionBand } from './onsetDetector';
import type { MetronomeEngine } from './audioEngine';
import workletUrl from './micWorklet.ts?worker&url';

/**
 * Microphone side of the accuracy meter (browser glue, no UI framework).
 * Designed for WIRED headphones: the click must not leak into the mic, and the
 * round-trip latency must be small and stable enough to calibrate once.
 */

export type OnsetListener = (time: number, peak: number) => void;
export type LevelListener = (peak: number) => void;

const BLUETOOTH_LABEL = /airpods|bluetooth|hands-?free|beats|buds|bose|jabra|\bwh-|\bwf-|headset \(/i;

const loadedContexts = new WeakSet<BaseAudioContext>();

export class AccuracyMeter {
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private testSource: AudioNode | null = null;
  private onsetListeners = new Set<OnsetListener>();
  private levelListeners = new Set<LevelListener>();
  private sensitivity = 5;
  private band: DetectionBand = 'full';
  private opening: Promise<void> | null = null;

  constructor(private readonly engine: MetronomeEngine) {}

  get isOpen(): boolean {
    return this.node !== null;
  }

  /** Facts that explain detection problems (shown in setup, useful in bug reports). */
  diagnostics(): Record<string, string> {
    const ac = this.engine.getContext();
    const track = this.stream?.getAudioTracks()[0];
    const st = (track?.getSettings?.() ?? {}) as MediaTrackSettings & { latency?: number };
    const ms = (s?: number) => (typeof s === 'number' ? `${(s * 1000).toFixed(1)} ms` : 'n/a');
    return {
      Browser: navigator.userAgent.match(/(Firefox|Edg|Chrome|Safari)\/[\d.]+/)?.[0] ?? navigator.userAgent,
      Input: track ? `${track.label || 'microphone'} (${track.readyState}${track.muted ? ', muted' : ''})` : this.testSource ? 'test source' : 'none',
      'Sample rate': `context ${ac.sampleRate} Hz, mic ${st.sampleRate ?? '?'} Hz`,
      'Processing off': `echo ${st.echoCancellation === false ? 'yes' : String(st.echoCancellation ?? '?')}, noise ${st.noiseSuppression === false ? 'yes' : String(st.noiseSuppression ?? '?')}, gain ${st.autoGainControl === false ? 'yes' : String(st.autoGainControl ?? '?')}`,
      Latency: `output ${ms(ac.outputLatency)}, base ${ms(ac.baseLatency)}, input ${ms(st.latency)}`,
      'Audio state': ac.state,
    };
  }

  /** Label of the microphone in use (available after permission is granted). */
  get inputLabel(): string {
    return this.stream?.getAudioTracks()[0]?.label ?? '';
  }

  /** Ask for the mic and start analysing. Safe to call repeatedly. */
  open(deviceId?: string | null): Promise<void> {
    if (this.node) return Promise.resolve();
    this.opening ??= this.doOpen(deviceId).finally(() => (this.opening = null));
    return this.opening;
  }

  private async doOpen(deviceId?: string | null): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser has no microphone access (HTTPS is required).');
    setAudioSession('play-and-record');
    const ac = this.engine.getContext();
    // Raw signal: echo cancellation, noise suppression and AGC smear attacks and add delay.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    if (ac.state !== 'running') await ac.resume();
    this.source = ac.createMediaStreamSource(this.stream);
    await this.connect(this.source);
  }

  /**
   * Testing aid: analyse any AudioNode instead of the microphone (e.g. the click
   * output itself, or synthetic "hits"). Used by the in-browser self-test.
   */
  async openTestSource(src: AudioNode): Promise<void> {
    this.close();
    this.testSource = src;
    await this.connect(src);
  }

  private async connect(src: AudioNode): Promise<void> {
    const ac = this.engine.getContext();
    if (!loadedContexts.has(ac)) {
      await ac.audioWorklet.addModule(workletUrl);
      loadedContexts.add(ac);
    }
    this.node = new AudioWorkletNode(ac, 'tactus-onset', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    this.node.port.postMessage({ sensitivity: this.sensitivity, band: this.band });
    this.node.port.onmessage = (e: MessageEvent<{ type: string; frame?: number; peak: number }>) => {
      if (e.data.type === 'onset') {
        const t = e.data.frame! / ac.sampleRate;
        this.onsetListeners.forEach((l) => l(t, e.data.peak));
      } else this.levelListeners.forEach((l) => l(e.data.peak));
    };
    // A silent sink keeps the node pulled by the graph in every browser.
    this.sink = ac.createGain();
    this.sink.gain.value = 0;
    src.connect(this.node);
    this.node.connect(this.sink);
    this.sink.connect(ac.destination);
  }

  close(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.source?.disconnect();
    if (this.testSource && this.node) this.testSource.disconnect(this.node);
    this.testSource = null;
    this.node?.disconnect();
    this.sink?.disconnect();
    this.stream = null;
    this.source = null;
    this.node = null;
    this.sink = null;
    setAudioSession('playback');
  }

  setSensitivity(s: number): void {
    this.sensitivity = s;
    this.node?.port.postMessage({ sensitivity: s });
  }

  /** 'low' in speaker mode: only listen below ~800 Hz so the tone click is ignored. */
  setBand(band: DetectionBand): void {
    this.band = band;
    this.node?.port.postMessage({ band });
  }

  onOnset(fn: OnsetListener): () => void {
    this.onsetListeners.add(fn);
    return () => this.onsetListeners.delete(fn);
  }

  onLevel(fn: LevelListener): () => void {
    this.levelListeners.add(fn);
    return () => this.levelListeners.delete(fn);
  }

  /**
   * Loopback calibration: the player holds an earbud against the microphone; we play
   * clicks and measure when the mic hears them. That is exactly the output + input
   * latency, without the player's own timing mixed in.
   */
  async calibrate(opts: { leakTest?: boolean } = {}): Promise<CalibrationResult> {
    await this.open();
    const heard: number[] = [];
    let peak = 0;
    const off = this.onOnset((t) => heard.push(t));
    const offL = this.onLevel((p) => (peak = Math.max(peak, p)));
    // The earbud is right at the mic and the room should be quiet: listen harder than during play.
    const userSensitivity = this.sensitivity;
    const userBand = this.band;
    // Loopback timing uses the broadband tick, so listen to the full band.
    this.node?.port.postMessage({ sensitivity: Math.max(8, userSensitivity), band: 'full' });
    const ac = this.engine.getContext();
    const waitUntil = (t: number) =>
      new Promise<void>((resolve) => {
        const check = () => (ac.currentTime >= t ? resolve() : setTimeout(check, 50));
        check();
      });
    try {
      const probes = await this.engine.playProbes(PROBE_GAPS);
      await waitUntil(probes[probes.length - 1] + 0.5);
      const r: CalibrationResult = { ...summarizeCalibration(probes, heard), peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity };
      if (!opts.leakTest || !r.ok) return r;

      // Speaker mode: play the real tone clicks (every voice) while the player is silent,
      // listening exactly as during play. Anything detected now is the click leaking through.
      this.node?.port.postMessage({ sensitivity: userSensitivity, band: 'low' });
      await new Promise((res) => setTimeout(res, 150)); // let the filter settle
      heard.length = 0;
      const tones = await this.engine.playProbes(PROBE_GAPS.slice(0, 7), 'tone', ['accent', 'normal', 'sub', 'countInAccent', 'soft', 'countIn', 'normal', 'accent']);
      await waitUntil(tones[tones.length - 1] + 0.4);
      const lat = r.latencyMs / 1000;
      const leaked = tones.filter((t) => heard.some((h) => h - (t + lat) > -0.03 && h - (t + lat) < 0.06)).length;
      return { ...r, leakTested: tones.length, leaked };
    } finally {
      off();
      offL();
      this.node?.port.postMessage({ sensitivity: userSensitivity, band: userBand });
    }
  }

  /** Audio inputs (labels appear once mic permission is granted). */
  static async inputs(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  }

  /** Best-effort: does any audio device name look like Bluetooth? (Browsers can't tell us the route.) */
  static async bluetoothSuspected(currentInputLabel = ''): Promise<boolean> {
    if (BLUETOOTH_LABEL.test(currentInputLabel)) return true;
    if (!navigator.mediaDevices?.enumerateDevices) return false;
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some((d) => d.deviceId === 'default' && BLUETOOTH_LABEL.test(d.label));
  }
}

function setAudioSession(type: 'playback' | 'play-and-record'): void {
  const s = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (s) {
    try {
      s.type = type;
    } catch {
      /* not supported */
    }
  }
}
