import { estimateDuration, schedule } from "../core/engine.js";
import type { SeNote, SeParams } from "../core/engine.js";
import { analyze, encodeWav, fitLength, normalize, toChannels, trimTail } from "../core/wav.js";
import type { WaveStats } from "../core/wav.js";

const SAMPLE_RATE = 44100;

let sharedContext: AudioContext | null = null;

/** ユーザー操作の中から呼ぶこと（自動再生ポリシーのため） */
export async function getContext(): Promise<AudioContext> {
  if (!sharedContext) sharedContext = new AudioContext({ sampleRate: SAMPLE_RATE });
  if (sharedContext.state === "suspended") await sharedContext.resume();
  return sharedContext;
}

/** 生成済みなら AudioContext を同期で返す。再生位置の追従など毎フレームの参照用 */
export function peekContext(): AudioContext | null {
  return sharedContext;
}

/**
 * 音が実際に聞こえ終わるまでの秒数。`schedule` の戻り値はディレイの尾を含まず、
 * `estimateDuration` は逆に余裕を持たせた値なので、どちらも再生位置の表示には使えない。
 * オフラインで鳴らして末尾を落とした長さが唯一正確。実測 3〜11ms。
 */
export async function measureSeconds(params: SeParams, notes: SeNote[]): Promise<number> {
  const duration = estimateDuration(params, notes);
  const ctx = new OfflineAudioContext(1, Math.ceil(SAMPLE_RATE * duration), SAMPLE_RATE);
  schedule(ctx, params, notes, ctx.destination, 0);
  return trimTail(toChannels(await ctx.startRendering()), SAMPLE_RATE, TIGHT)[0].length / SAMPLE_RATE;
}

export interface Playback {
  stop: () => void;
  /** 先頭のノートが鳴り出す時刻（AudioContext の currentTime 基準） */
  startAt: number;
  /** 鳴り終わる時刻（AudioContext の currentTime 基準） */
  endTime: number;
  /** 呼び出し時点から鳴り終わるまでのミリ秒。ループ再生では Infinity */
  durationMs: number;
  /** ループ再生ならその周期（秒）。再生カーソルはこれで折り返す */
  loopSeconds?: number;
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
  schedule(ctx, params, notes, gate, startAt);
  // 鳴らし始めてから測る。ここで待っても発音はもう始まっている。
  // schedule の戻り値は使わない。あれは release の終わりまでを見た値で、
  // エンベロープが指数接近する以上いつも長すぎる（release 1.79 の例で 2.92s に対し
  // 実際に聞こえるのは 2.22s）。波形と再生カーソルがそのぶん食い違う
  const endTime = startAt + (await measureSeconds(params, notes));

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    const now = ctx.currentTime;
    gate.gain.setValueAtTime(gate.gain.value, now);
    gate.gain.linearRampToValueAtTime(0, now + 0.05);
    setTimeout(() => gate.disconnect(), 120);
  };

  return { stop, startAt, endTime, durationMs: Math.max(0, (endTime - ctx.currentTime) * 1000) };
}

/**
 * 尺を揃えた素材を鳴らす。**通常の再生（`play`）とは鳴らすものが違う。**
 * `play` は今作っている音をそのまま鳴らすが、こちらは書き出しと同じ経路（レンダリング →
 * `fitLength`）を通したものを鳴らす。尺を指定している時点で「尺の中が作品」なので、
 * 単発でもそちらを聞かせる。はみ出しは波形の表示で分かる。
 *
 * ループでは特に、切っていない音を重ねるとはみ出た余韻が次の周にかぶって
 * 「押し出しループ」になり、実際に書き出される素材の確認にならない。
 */
export async function playFixed(
  params: SeParams,
  notes: SeNote[],
  seconds: number,
  loop: boolean
): Promise<Playback> {
  const ctx = await getContext();
  const offline = new OfflineAudioContext(
    1,
    Math.ceil(SAMPLE_RATE * Math.max(estimateDuration(params, notes), seconds)),
    SAMPLE_RATE
  );
  schedule(offline, params, notes, offline.destination, 0);
  const channels = fitLength(
    trimTail(toChannels(await offline.startRendering()), SAMPLE_RATE),
    SAMPLE_RATE,
    seconds
  );

  const buffer = ctx.createBuffer(1, channels[0].length, SAMPLE_RATE);
  buffer.getChannelData(0).set(channels[0]);

  const gate = ctx.createGain();
  gate.connect(ctx.destination);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = loop;
  source.connect(gate);

  const startAt = ctx.currentTime + 0.03;
  source.start(startAt);

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    const now = ctx.currentTime;
    gate.gain.setValueAtTime(gate.gain.value, now);
    gate.gain.linearRampToValueAtTime(0, now + 0.05);
    setTimeout(() => {
      source.stop();
      gate.disconnect();
    }, 120);
  };

  // ループは止めるまで鳴り続ける。App 側は durationMs が有限かどうかで停止タイマーを張る
  const endTime = loop ? Infinity : startAt + seconds;
  return {
    stop,
    startAt,
    endTime,
    durationMs: loop ? Infinity : Math.max(0, (endTime - ctx.currentTime) * 1000),
    loopSeconds: loop ? seconds : undefined,
  };
}

export interface RenderOptions {
  trim?: boolean;
  normalizeDb?: number | null;
  /** 指定するとこの長さちょうどに揃える（ループ素材向け）。null なら音が終わるまで */
  seconds?: number | null;
}

export interface RenderResult {
  blob: Blob;
  stats: WaveStats;
}

/** オフラインレンダリングして WAV Blob と波形統計を返す */
export async function renderWav(
  params: SeParams,
  notes: SeNote[],
  { trim = true, normalizeDb = null, seconds = null }: RenderOptions = {}
): Promise<RenderResult> {
  // 尺を指定するときは、その長さより短く見積もると音が足りなくなる
  const duration = Math.max(estimateDuration(params, notes), seconds ?? 0);
  const ctx = new OfflineAudioContext(1, Math.ceil(SAMPLE_RATE * duration), SAMPLE_RATE);
  schedule(ctx, params, notes, ctx.destination, 0);

  let channels = toChannels(await ctx.startRendering());
  if (trim) channels = trimTail(channels, SAMPLE_RATE);
  if (normalizeDb !== null) channels = normalize(channels, normalizeDb);
  // 尺揃えは最後。normalize より先にやると、切った後のピークで正規化されてしまう
  if (seconds !== null) channels = fitLength(channels, SAMPLE_RATE, seconds);

  return {
    blob: new Blob([encodeWav(channels, SAMPLE_RATE)], { type: "audio/wav" }),
    stats: analyze(channels, SAMPLE_RATE),
  };
}

export interface Peaks {
  /** バケットごとの最小値・最大値（-1〜1）。描画幅ぶん並ぶ */
  min: Float32Array;
  max: Float32Array;
  /** そのバケットがリミッターに当たっているか */
  hot: boolean[];
  /** 音の実際の長さ（秒）。window を超えていれば右端で切れている */
  seconds: number;
  /** 全体のピーク（dBFS） */
  peakDb: number;
}

/**
 * 末尾の切り方。既定の `trimTail` は音が消えた位置に 50ms の余韻を足して返す。
 * WAV の書き出しにはそれでよいが、長さの測定に使うと常に 0.05秒長くなり、
 * 再生カーソルが波形の終端をそのぶん追い越す。
 */
const TIGHT = { tailMs: 0 };

/** リミッターの threshold は -1dB。そこに達していれば潰れている */
const HOT_LEVEL = Math.pow(10, -1 / 20);

/**
 * 波形表示用にレンダリングして、バケットごとの min/max に畳む。
 * 全サンプルを返すと 44100×数秒ぶんを毎回描くことになるので、描画幅まで先に落とす。
 *
 * `window`（秒）は横軸に割り当てる時間で、呼び出し側がピアノロールのグリッドに
 * 合わせて決める。音がそれより長い分は捨てる（`seconds` で判別できる）。
 * 音全体を幅に押し込むとピアノロールと時間軸がずれ、真下に並べる意味が消える。
 */
export async function renderPeaks(
  params: SeParams,
  notes: SeNote[],
  buckets: number,
  window: number
): Promise<Peaks> {
  const duration = estimateDuration(params, notes);
  const ctx = new OfflineAudioContext(1, Math.ceil(SAMPLE_RATE * duration), SAMPLE_RATE);
  schedule(ctx, params, notes, ctx.destination, 0);
  const data = trimTail(toChannels(await ctx.startRendering()), SAMPLE_RATE, TIGHT)[0];

  const min = new Float32Array(buckets);
  const max = new Float32Array(buckets);
  const hot: boolean[] = new Array(buckets).fill(false);
  const per = (SAMPLE_RATE * window) / buckets;
  let peak = 0;

  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(b * per);
    if (from >= data.length) break; // 音のほうが短い。右側は空のまま
    const to = Math.min(data.length, Math.floor((b + 1) * per));
    let lo = data[from];
    let hi = data[from];
    for (let i = from + 1; i < to; i++) {
      const v = data[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[b] = lo;
    max[b] = hi;
    const amp = Math.max(Math.abs(lo), Math.abs(hi));
    if (amp > peak) peak = amp;
    hot[b] = amp >= HOT_LEVEL;
  }

  return {
    min,
    max,
    hot,
    seconds: data.length / SAMPLE_RATE,
    peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
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
