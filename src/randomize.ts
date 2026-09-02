import { DEFAULT_PARAMS } from "./core/engine.js";
import type { OscillatorKind, SeNote, SeParams } from "./core/engine.js";

export const SAMPLE_KINDS = ["laser", "coin", "jump", "powerup", "damage", "bomb"] as const;
export type SampleKind = (typeof SAMPLE_KINDS)[number] | "random";

const r = (min: number, max: number) => Math.random() * (max - min) + min;
const pick = <T>(...items: T[]): T => items[Math.floor(Math.random() * items.length)];
const coin = (p = 0.5) => Math.random() < p;

export const newNoteId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);

const note = (pitch: string, width: number): SeNote => ({
  id: newNoteId(),
  time: "0:0:0",
  pitch,
  width,
  velocity: 0.8,
});

/**
 * カテゴリごとの「らしさ」を保った範囲で毎回違う音を作る。
 * 決まった1点が欲しいときは presets/*.json を読み込む。
 */
export function makeSample(kind: SampleKind): { params: SeParams; note: SeNote } {
  const base = { ...DEFAULT_PARAMS, masterVolume: -6 };

  switch (kind) {
    case "laser":
      return {
        params: {
          ...base,
          oscillatorType: pick<OscillatorKind>("sawtooth", "square"),
          pitchAmount: r(24, 48) * (coin() ? 1 : -1),
          pitchTime: r(0.1, 0.4),
          filterCutoff: r(1000, 8000),
          filterEnvAmount: r(1000, 6000),
          decay: r(0.1, 0.4),
          sustain: r(0, 0.2),
          release: r(0.1, 0.5),
          delayFeedback: r(0.1, 0.4),
          lfoRate: r(5, 15),
          lfoDepth: coin() ? r(5, 20) : 0,
          lfoTarget: "filter",
        },
        note: note("C5", 2),
      };

    case "bomb":
      return {
        params: {
          ...base,
          oscillatorType: "noise",
          attack: 0.01,
          decay: r(0.5, 2.0),
          sustain: 0,
          release: r(1.0, 3.0),
          filterCutoff: r(300, 1000),
          filterEnvAmount: r(500, 2000),
          masterVolume: -3,
          lfoRate: r(0.1, 2),
          lfoDepth: r(10, 50),
          lfoTarget: "filter",
        },
        note: note("C2", 4),
      };

    case "coin":
      return {
        params: {
          ...base,
          oscillatorType: pick<OscillatorKind>("sine", "triangle"),
          attack: 0.005,
          decay: r(0.1, 0.3),
          sustain: 0,
          release: r(0.1, 0.4),
          arpAmount: coin() ? 0 : 12,
          repeatSpeed: coin(0.3) ? r(15, 25) : 0,
          filterCutoff: 8000,
          detune: r(0, 10),
        },
        note: note("C6", 1),
      };

    case "powerup":
      return {
        params: {
          ...base,
          oscillatorType: "square",
          attack: r(0.01, 0.1),
          decay: r(0.2, 0.5),
          sustain: 0.4,
          release: 0.5,
          pitchAmount: r(12, 24),
          pitchTime: 0.3,
          repeatSpeed: r(10, 30),
          arpAmount: r(1, 5),
          filterCutoff: r(2000, 5000),
          delayFeedback: 0.3,
          lfoRate: r(2, 8),
          lfoDepth: r(5, 15),
          lfoTarget: "pitch",
        },
        note: note("C4", 3),
      };

    case "damage":
      return {
        params: {
          ...base,
          oscillatorType: pick<OscillatorKind>("sawtooth", "square"),
          pitchAmount: r(-24, -12),
          pitchTime: r(0.05, 0.2),
          attack: 0.01,
          decay: 0.2,
          sustain: 0.1,
          release: 0.2,
          repeatSpeed: r(20, 50),
          arpAmount: r(-6, -1),
          filterCutoff: r(1000, 3000),
          lfoRate: r(10, 20),
          lfoDepth: r(20, 50),
          lfoTarget: "pitch",
        },
        note: note("C3", 1),
      };

    case "jump":
      return {
        params: {
          ...base,
          oscillatorType: pick<OscillatorKind>("sine", "square"),
          pitchAmount: r(12, 36),
          pitchTime: r(0.1, 0.3),
          attack: 0.01,
          decay: 0.2,
          sustain: 0.1,
          release: 0.2,
        },
        note: note("C4", 1),
      };

    case "random":
    default:
      return {
        params: {
          ...base,
          oscillatorType: pick<OscillatorKind>("sine", "square", "sawtooth", "triangle", "noise"),
          attack: r(0.001, 0.5),
          decay: r(0.05, 1.0),
          sustain: r(0, 0.8),
          release: r(0.05, 2.0),
          pitchAmount: r(-48, 48),
          pitchTime: r(0.01, 1.0),
          filterCutoff: r(100, 8000),
          filterEnvAmount: r(0, 5000),
          repeatSpeed: coin(0.4) ? r(0, 40) : 0,
          arpAmount: Math.floor(r(-12, 12)),
          delayFeedback: coin() ? r(0, 0.6) : 0,
          lfoRate: r(0.1, 20),
          lfoDepth: coin() ? r(0, 80) : 0,
          lfoTarget: coin() ? "pitch" : "filter",
          detune: coin() ? r(0, 50) : 0,
        },
        note: note("C4", 2),
      };
  }
}
