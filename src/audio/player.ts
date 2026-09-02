import { estimateDuration, schedule } from "../core/engine.js";
import type { SeNote, SeParams } from "../core/engine.js";
import { analyze, encodeWav, normalize, toChannels, trimTail } from "../core/wav.js";
import type { WaveStats } from "../core/wav.js";

const SAMPLE_RATE = 44100;

let sharedContext: AudioContext | null = null;

/** ユーザー操作の中から呼ぶこと（自動再生ポリシーのため） */
export async function getContext(): Promise<AudioContext> {
  if (!sharedContext) sharedContext = new AudioContext({ sampleRate: SAMPLE_RATE });
  if (sharedContext.state === "suspended") await sharedContext.resume();
  return sharedContext;
}

export interface Playback {
  stop: () => void;
  /** 鳴り終わる時刻（AudioContext の currentTime 基準） */
  endTime: number;
  /** 呼び出し時点から鳴り終わるまでのミリ秒 */
  durationMs: number;
}

/**
 * 即時再生する。再生ごとに gate を1つ挟み、stop() では gate をフェードアウトして
 * 切り離す。engine が作ったノードは gate を外せば参照が切れて回収される。
 */
export async function play(params: SeParams, notes: SeNote[]): Promise<Playback> {
  const ctx = await getContext();
  const gate = ctx.createGain();
  gate.connect(ctx.destination);

  const startAt = ctx.currentTime + 0.03;
  const { endTime } = schedule(ctx, params, notes, gate, startAt);

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    const now = ctx.currentTime;
    gate.gain.setValueAtTime(gate.gain.value, now);
    gate.gain.linearRampToValueAtTime(0, now + 0.05);
    setTimeout(() => gate.disconnect(), 120);
  };

  return { stop, endTime, durationMs: Math.max(0, (endTime - ctx.currentTime) * 1000) };
}

export interface RenderOptions {
  trim?: boolean;
  normalizeDb?: number | null;
}

export interface RenderResult {
  blob: Blob;
  stats: WaveStats;
}

/** オフラインレンダリングして WAV Blob と波形統計を返す */
export async function renderWav(
  params: SeParams,
  notes: SeNote[],
  { trim = true, normalizeDb = null }: RenderOptions = {}
): Promise<RenderResult> {
  const duration = estimateDuration(params, notes);
  const ctx = new OfflineAudioContext(1, Math.ceil(SAMPLE_RATE * duration), SAMPLE_RATE);
  schedule(ctx, params, notes, ctx.destination, 0);

  let channels = toChannels(await ctx.startRendering());
  if (trim) channels = trimTail(channels, SAMPLE_RATE);
  if (normalizeDb !== null) channels = normalize(channels, normalizeDb);

  return {
    blob: new Blob([encodeWav(channels, SAMPLE_RATE)], { type: "audio/wav" }),
    stats: analyze(channels, SAMPLE_RATE),
  };
}

/** Blob をダウンロードさせる。ObjectURL は必ず解放する。 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
