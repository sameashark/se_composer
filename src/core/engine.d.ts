export type OscillatorKind = "sine" | "square" | "sawtooth" | "triangle" | "noise";
export type LfoTarget = "pitch" | "filter";

export interface SeParams {
  bpm: number;
  oscillatorType: OscillatorKind;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  pitchAmount: number;
  pitchTime: number;
  arpAmount: number;
  repeatSpeed: number;
  detune: number;
  lfoRate: number;
  lfoDepth: number;
  lfoTarget: LfoTarget;
  filterCutoff: number;
  filterEnvAmount: number;
  delayFeedback: number;
  masterVolume: number;
}

export interface SeNote {
  id: string;
  /** "小節:拍:16分" または先頭からの16分音符数 */
  time: string | number;
  /** "C4" / "F#3" / "Bb5" */
  pitch: string;
  /** 16分音符いくつ分か */
  width: number;
  /** 0〜1 */
  velocity: number;
}

export interface Preset {
  name?: string;
  params: SeParams;
  notes: SeNote[];
}

export declare const DEFAULT_PARAMS: SeParams;
export declare const OSCILLATOR_TYPES: OscillatorKind[];

export declare function noteToFreq(name: string): number;
export declare function timeToStep(time: string | number): number;
export declare function normalizePreset(input: unknown): {
  params: SeParams;
  notes: SeNote[];
  /** pitch が無い・不正で読み飛ばしたノートの数 */
  skipped: number;
};
export declare function estimateDuration(params: SeParams, notes: SeNote[]): number;
export declare function schedule(
  ctx: BaseAudioContext,
  params: SeParams,
  notes: SeNote[],
  destination: AudioNode,
  when?: number
): { endTime: number };
