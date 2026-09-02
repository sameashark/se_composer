/**
 * SE-Composer 音源コア。
 * ブラウザ / Node (node-web-audio-api) の両方で動く。AudioContext は呼び出し側が渡す。
 * Web UI と CLI が同じ音を出すため、音の実装はこのファイルだけに置く。
 *
 * 信号の流れと各カーブは、旧版（Tone.js 実装）の音を再現することを優先している。
 * Tone を外したのは Node で動かないためであって、音を変えるためではない。
 */

export const DEFAULT_PARAMS = {
  bpm: 120,
  oscillatorType: "triangle",
  attack: 0.01,
  decay: 0.2,
  sustain: 0.2,
  release: 0.2,
  pitchAmount: 0,
  pitchTime: 0.1,
  arpAmount: 0,
  repeatSpeed: 0,
  detune: 0,
  lfoRate: 5,
  lfoDepth: 0,
  lfoTarget: "pitch",
  filterCutoff: 2000,
  filterEnvAmount: 0,
  delayFeedback: 0.2,
  masterVolume: -6,
};

export const OSCILLATOR_TYPES = ["sine", "square", "sawtooth", "triangle", "noise"];

const SEMITONE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** "C4" / "F#3" / "Bb5" -> Hz */
export function noteToFreq(name) {
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(String(name).trim());
  if (!m) throw new Error(`invalid pitch: ${name}`);
  const semi = SEMITONE[m[1].toLowerCase()] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
  const midi = (Number(m[3]) + 1) * 12 + semi;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** "0:1:2" (bar:beat:sixteenth) -> 先頭からの16分音符数。数値ならそのまま列番号。 */
export function timeToStep(time) {
  if (typeof time === "number") return time;
  const p = String(time).split(":").map(Number);
  if (p.length === 3) return p[0] * 16 + p[1] * 4 + p[2];
  if (p.length === 2) return p[0] * 4 + p[1];
  return p[0] || 0;
}

const dbToGain = (db) => Math.pow(10, db / 20);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const stepTime = (bpm) => 60 / bpm / 4;

/**
 * ディレイ時間。旧版は Tone.FeedbackDelay("8n") を使っていたが Tone.Transport の BPM を
 * 一度も設定していなかったため、プリセットの bpm に関係なく常に既定の 120BPM で解決され、
 * 0.25 秒固定だった。bpm に追従させると低速なプリセットでエコーの位置が大きくずれるので、
 * 旧版に合わせて固定する。
 */
const DELAY_TIME = 60 / 120 / 2;

/** Tone.Param の最小出力値 */
const MIN_OUTPUT = 1e-5;

const PITCH_RE = /^[A-Ga-g][#b]?-?\d+$/;

/**
 * プリセットJSON（Web UI のエクスポート形式 / 単体プリセット / 裸の params）を
 * { params, notes, skipped } に正規化する。
 *
 * pitch を持たないノートは既定値で補わずに捨てる。旧版のピアノロールは pitch が
 * undefined のノートを描画も再生もしなかったため、そういうノートが残った JSON が
 * 実在する。補ってしまうと元データに無い音が鳴る。
 */
export function normalizePreset(input) {
  const src = input?.current ?? input;
  const rawParams = src?.params ?? src ?? {};
  const params = { ...DEFAULT_PARAMS };
  for (const key of Object.keys(DEFAULT_PARAMS)) {
    const value = rawParams[key];
    if (value === undefined || value === null) continue;
    if (typeof DEFAULT_PARAMS[key] === "number") {
      const num = Number(value);
      if (Number.isFinite(num)) params[key] = num;
    } else {
      params[key] = value;
    }
  }
  if (!OSCILLATOR_TYPES.includes(params.oscillatorType)) params.oscillatorType = DEFAULT_PARAMS.oscillatorType;
  if (params.lfoTarget !== "pitch" && params.lfoTarget !== "filter") params.lfoTarget = "pitch";

  const hasNotesField = Array.isArray(src?.notes);
  const notes = [];
  let skipped = 0;
  if (hasNotesField) {
    src.notes.forEach((n, i) => {
      if (!n || typeof n.pitch !== "string" || !PITCH_RE.test(n.pitch.trim())) {
        skipped++;
        return;
      }
      const velocity = Number(n.velocity);
      notes.push({
        id: n.id ?? `n${i}`,
        time: n.time ?? "0:0:0",
        pitch: n.pitch.trim(),
        width: Math.max(1, Number(n.width) || 1),
        velocity: Number.isFinite(velocity) ? clamp(velocity, 0, 1) : 0.8,
      });
    });
  }
  if (!hasNotesField) notes.push({ id: "n0", time: "0:0:0", pitch: "C4", width: 2, velocity: 0.8 });

  return { params, notes, skipped };
}

/** レンダリングに必要な長さ（秒） */
export function estimateDuration(params, notes) {
  const st = stepTime(params.bpm);
  const delayTime = DELAY_TIME;
  let end = 0;
  for (const n of notes) {
    const t = timeToStep(n.time) * st + n.width * st + Math.max(params.release, 0.001);
    if (t > end) end = t;
  }
  const fb = clamp(params.delayFeedback, 0, 0.95);
  const tail = fb > 0.01 ? Math.min(delayTime * (Math.log(0.001) / Math.log(fb)), 8) : 0;
  // 原音自体がディレイを通るので、その分（delayTime）も必ず足す
  return end + delayTime + tail + 0.3;
}

/**
 * ブラウンノイズ（Tone.Noise の brown 相当）。
 *
 * Math.random で毎回生成すると、ブラウンノイズはランダムウォークゆえに個体差が大きく、
 * 鳴らすたびに音が変わってしまう。SE は同じ設定なら同じ音が出る必要があるので、
 * 固定シードの PRNG で作った波形をキャッシュして使い回す（ブラウザと CLI でも一致する）。
 */
let noiseCache = null;

function noiseData(length) {
  if (noiseCache && noiseCache.length === length) return noiseCache;
  const data = new Float32Array(length);
  let seed = 0x9e3779b9 | 0;
  let last = 0;
  for (let i = 0; i < length; i++) {
    seed ^= seed << 13;
    seed |= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed |= 0;
    const white = ((seed >>> 0) / 4294967296) * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }
  noiseCache = data;
  return data;
}

function createNoiseBuffer(ctx, seconds) {
  const len = Math.max(1, Math.ceil(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  buf.getChannelData(0).set(noiseData(len));
  return buf;
}

/** Tone.Param.exponentialApproachValueAtTime の移植 */
function exponentialApproach(param, value, time, rampTime) {
  const tc = Math.max(Math.log(rampTime + 1) / Math.log(200), 1e-4);
  param.setTargetAtTime(value, time, tc);
  param.cancelAndHoldAtTime(time + rampTime);
  param.linearRampToValueAtTime(value, time + rampTime);
}

/**
 * Tone.Envelope 互換のエンベロープ。
 *
 * decay / release は「指定時刻にちょうど到達する ramp」ではなく時定数による指数接近で、
 * この裾の伸び方が音の余韻そのものになっている。また triggerAttack は現在値から
 * 残り距離分だけ attack するため、連打すると値が積み上がって滑らかにつながる。
 * どちらも AudioParam の自動化だけでは現在値を読めないので、JS 側で値を追跡する。
 */
function createEnvelope(ctx, param, params) {
  const attack = Math.max(params.attack, 0);
  const decay = Math.max(params.decay, 0.001);
  const sustain = clamp(params.sustain, 0, 1);
  const release = Math.max(params.release, 0.001);
  const sampleTime = 1 / ctx.sampleRate;

  let atkStart = -Infinity;
  let atkEnd = -Infinity;
  let atkFrom = 0;
  let peak = 0;
  let susTarget = 0;
  let decayTc = 1e-4;
  let decayEnd = -Infinity;
  let relStart = Infinity;
  let relFrom = 0;
  let relTc = 1e-4;
  let relEnd = Infinity;

  const valueAt = (t) => {
    if (t >= relStart) return t >= relEnd ? 0 : relFrom * Math.exp(-(t - relStart) / relTc);
    if (t <= atkStart) return atkFrom;
    if (t < atkEnd) return atkFrom + (peak - atkFrom) * ((t - atkStart) / (atkEnd - atkStart));
    if (t >= decayEnd) return susTarget;
    return susTarget + (peak - susTarget) * Math.exp(-(t - atkEnd) / decayTc);
  };

  return {
    valueAt,

    triggerAttack(time, velocity = 1) {
      const current = valueAt(time);
      // Tone と同じく、既に鳴っている分だけ attack を短くする
      let a = current > 0 ? (1 - current) * attack : attack;
      if (a < 0) a = 0;

      param.cancelAndHoldAtTime(time);
      param.setValueAtTime(Math.max(current, MIN_OUTPUT), time);
      if (a < sampleTime) {
        param.setValueAtTime(velocity, time);
        a = 0;
      } else {
        param.linearRampToValueAtTime(velocity, time + a);
      }

      const target = velocity * sustain;
      exponentialApproach(param, target, time + a, decay);

      atkStart = time;
      atkEnd = time + a;
      atkFrom = Math.max(current, MIN_OUTPUT);
      peak = velocity;
      susTarget = target;
      decayTc = Math.max(Math.log(decay + 1) / Math.log(200), 1e-4);
      decayEnd = time + a + decay;
      relStart = Infinity;
      relEnd = Infinity;
      return atkEnd;
    },

    triggerRelease(time) {
      const current = valueAt(time);
      if (current <= 0) return time;
      param.cancelAndHoldAtTime(time);
      param.setValueAtTime(Math.max(current, MIN_OUTPUT), time);
      exponentialApproach(param, 0, time, release);

      relStart = time;
      relFrom = current;
      relTc = Math.max(Math.log(release + 1) / Math.log(200), 1e-4);
      relEnd = time + release;
      return relEnd;
    },
  };
}

/**
 * ノート1つ分の信号経路。旧版と同じくノートごとに独立して作る。
 *
 *   osc/noise -> amp(envelope) -> volume -> delay <-> feedback -> filter -> limiter -> destination
 *
 * ディレイは 100% wet（Tone.FeedbackDelay を直列に挟んでいた旧版と同じ）。
 * 原音自体が delayTime だけ遅れてフィルタに届き、そのずれも音色の一部になっている。
 */
function buildNoteChain(ctx, params, destination, volumeDb) {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.01;
  limiter.connect(destination);

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = clamp(params.filterCutoff, 20, 20000);
  filter.Q.value = 2;
  filter.connect(limiter);

  const delay = ctx.createDelay(2);
  delay.delayTime.value = DELAY_TIME;
  const feedback = ctx.createGain();
  feedback.gain.value = clamp(params.delayFeedback, 0, 0.9);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(filter);

  const volume = ctx.createGain();
  volume.gain.value = dbToGain(volumeDb);
  volume.connect(delay);

  // LFO もノートごと。pitch 指定でも noise には変調先が無いので作らない
  let lfoDetune = null;
  const depth = Number(params.lfoDepth) || 0;
  if (depth > 0) {
    const isPitch = params.lfoTarget === "pitch";
    if (!isPitch || params.oscillatorType !== "noise") {
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = Math.max(params.lfoRate, 0.01);
      const amount = ctx.createGain();
      amount.gain.value = isPitch ? depth * 10 : depth * 20; // pitch: cents / filter: Hz
      lfo.connect(amount);
      lfo.start(0);
      if (isPitch) lfoDetune = amount;
      else amount.connect(filter.frequency);
    }
  }

  return { input: volume, filter, lfoDetune };
}

/**
 * 同時に鳴っているノートの最大数。release の裾まで含めて数える。
 * 旧版は「譜面上のノート総数」で割っていたが、それだと時間をずらして並べただけの
 * メロディまで小さくなる。SE は同時発音が普通なので実測値はほぼ一致する。
 */
function maxPolyphony(params, notes) {
  const st = stepTime(params.bpm);
  const events = [];
  for (const n of notes) {
    const start = timeToStep(n.time) * st;
    events.push([start, 1], [start + Math.max(n.width * st, 0.001) + Math.max(params.release, 0.001), -1]);
  }
  // 同時刻なら終了(-1)を先に処理し、隣り合うだけのノートを重複と数えない
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0;
  let max = 0;
  for (const [, delta] of events) {
    current += delta;
    if (current > max) max = current;
  }
  return Math.max(1, max);
}

/**
 * ノート群を ctx にスケジュールする。
 * @returns {{ endTime: number }}
 */
export function schedule(ctx, params, notes, destination, when = 0) {
  const st = stepTime(params.bpm);
  // 旧版と同じ減衰カーブ（15dB/decade）を、同時発音数に対して適用する
  const volumeDb = params.masterVolume - Math.log10(maxPolyphony(params, notes)) * 15;
  const isNoise = params.oscillatorType === "noise";
  const noiseBuf = isNoise ? createNoiseBuffer(ctx, 2) : null;
  const sustainIsZero = clamp(params.sustain, 0, 1) === 0;
  const attack = Math.max(params.attack, 0);
  const decay = Math.max(params.decay, 0.001);

  let endTime = when;

  for (const note of notes) {
    const chain = buildNoteChain(ctx, params, destination, volumeDb);
    const t0 = when + timeToStep(note.time) * st;
    const total = Math.max(note.width * st, 0.001);
    const velocity = note.velocity === undefined ? 0.8 : clamp(note.velocity, 0, 1);

    // エンベロープと出力段はノート単位で共有する。repeat 時に前の音の値から
    // 続けて attack するのが旧版の挙動で、音の連なり方がここで決まる
    const amp = ctx.createGain();
    amp.gain.value = 0;
    amp.connect(chain.input);
    const envelope = createEnvelope(ctx, amp.gain, params);

    if (params.filterEnvAmount !== 0) {
      chain.filter.detune.setValueAtTime(0, t0);
      chain.filter.detune.linearRampToValueAtTime(params.filterEnvAmount, t0 + Math.max(attack, 0.001));
      chain.filter.detune.linearRampToValueAtTime(0, t0 + Math.max(attack, 0.001) + decay);
    }

    const baseFreq = isNoise ? 0 : noteToFreq(note.pitch);

    // detune は発音体をまたいで1本。旧版の Tone.Synth.detune が Signal を全オシレータへ
    // 配っていたのと同じで、repeat 中も setValueAtTime とランプが1本の時系列に積まれる。
    // pitchTime が repeat 間隔より長いと、ランプの終端が数 hit 先に届いて急峻に跳ね上がる。
    // 譜面から素直に想像する音ではないが、これが既存プリセットの「跳ね」を作っている。
    let detuneSignal = null;
    if (!isNoise) {
      detuneSignal = ctx.createConstantSource();
      detuneSignal.offset.value = 0;
      if (chain.lfoDetune) chain.lfoDetune.connect(detuneSignal.offset);
      detuneSignal.start(t0);
    }

    // ノイズは鳴らし続けてエンベロープだけ叩き直す。hit ごとに鳴らし直すと同じ波形の
    // 先頭が繰り返され、repeatSpeed がそのままピッチとして聞こえてしまう
    let noiseSource = null;
    if (isNoise) {
      noiseSource = ctx.createBufferSource();
      noiseSource.buffer = noiseBuf;
      noiseSource.loop = true;
      noiseSource.connect(amp);
      noiseSource.start(t0);
    }

    let lastStop = t0;

    // 音程を持つ発音体は常に1つ。旧版（Tone.Source）は再トリガのたびに前の音を止めて
    // 鳴らし直す。stop() は一度しか呼べないので、次に鳴らす時刻を先に受け取る
    const trigger = (freq, time, duration, nextTime) => {
      envelope.triggerAttack(time, velocity);
      const releaseEnd = envelope.triggerRelease(time + duration);
      // sustain が 0 のとき、旧版は attack+decay で発音を止め release を待たない
      const natural = sustainIsZero ? Math.min(time + attack + decay, releaseEnd) : releaseEnd;
      const stopAt = nextTime === undefined ? natural + 0.01 : Math.min(natural + 0.01, nextTime);

      if (!isNoise) {
        const osc = ctx.createOscillator();
        osc.type = params.oscillatorType;
        osc.frequency.setValueAtTime(freq, time);
        osc.detune.value = 0; // detune は detuneSignal から入力する
        detuneSignal.connect(osc.detune);
        osc.connect(amp);
        osc.start(time);
        osc.stop(stopAt);

        detuneSignal.offset.setValueAtTime(params.detune, time);
        if (params.pitchAmount !== 0) {
          detuneSignal.offset.linearRampToValueAtTime(
            params.detune + params.pitchAmount * 100,
            time + Math.max(params.pitchTime, 0.001)
          );
        }
      }

      if (stopAt > lastStop) lastStop = stopAt;
    };

    if (params.repeatSpeed > 0) {
      const interval = 1 / params.repeatSpeed;
      const hits = [];
      for (let t = 0, count = 0; t < total; t += interval, count++) {
        hits.push({
          time: t0 + t,
          duration: Math.min(interval * 0.9, total - t),
          freq: baseFreq * Math.pow(2, (params.arpAmount * count) / 12),
        });
      }
      hits.forEach((hit, i) => trigger(hit.freq, hit.time, hit.duration, hits[i + 1]?.time));
    } else {
      trigger(baseFreq, t0, total);
    }

    if (noiseSource) noiseSource.stop(lastStop);
    if (detuneSignal) detuneSignal.stop(lastStop);
    if (lastStop > endTime) endTime = lastStop;
  }

  return { endTime: endTime + DELAY_TIME };
}
