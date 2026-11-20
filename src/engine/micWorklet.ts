/**
 * AudioWorklet processor: runs the onset detector on the microphone signal on the
 * audio thread. Frames are on the AudioContext clock, so onset times compare
 * directly with scheduled click times.
 */
import { OnsetDetector, type DetectionBand } from './onsetDetector';

declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: unknown): void;

class OnsetProcessor extends AudioWorkletProcessor {
  private det = new OnsetDetector({ sampleRate, sensitivity: 5 });
  private levelPeak = 0;
  private levelFrames = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<{ sensitivity?: number; band?: DetectionBand }>) => {
      if (typeof e.data.sensitivity === 'number') this.det.setSensitivity(e.data.sensitivity);
      if (e.data.band) this.det.setBand(e.data.band);
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0];
    if (ch) {
      for (const o of this.det.process(ch, currentFrame)) this.port.postMessage({ type: 'onset', frame: o.frame, peak: o.peak });
      for (let i = 0; i < ch.length; i++) this.levelPeak = Math.max(this.levelPeak, Math.abs(ch[i]));
      this.levelFrames += ch.length;
      if (this.levelFrames >= sampleRate / 20) {
        this.port.postMessage({ type: 'level', peak: this.levelPeak });
        this.levelPeak = 0;
        this.levelFrames = 0;
      }
    }
    return true;
  }
}

registerProcessor('tactus-onset', OnsetProcessor);
