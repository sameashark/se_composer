/** AudioBuffer とチャンネル配列（Float32Array[]）の間の変換・加工・計測 */

export function toChannels(buffer) {
  const out = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) out.push(Float32Array.from(buffer.getChannelData(ch)));
  return out;
}

const peakOf = (channels) => {
  let peak = 0;
  for (const d of channels) for (let i = 0; i < d.length; i++) {
    const a = Math.abs(d[i]);
    if (a > peak) peak = a;
  }
  return peak;
};

/** 末尾の無音を落とす。SE は estimateDuration が余裕を持たせる分だけ必ず余る。 */
export function trimTail(channels, sampleRate, { floorDb = -60, tailMs = 50 } = {}) {
  const peak = peakOf(channels);
  if (peak === 0) return channels;
  const floor = peak * Math.pow(10, floorDb / 20);
  let last = 0;
  for (const d of channels) {
    for (let i = d.length - 1; i >= 0; i--) {
      if (Math.abs(d[i]) > floor) {
        if (i > last) last = i;
        break;
      }
    }
  }
  const end = Math.min(channels[0].length, last + 1 + Math.ceil((tailMs / 1000) * sampleRate));
  return channels.map((d) => d.subarray(0, end));
}

/** ピークを targetDb に揃える */
export function normalize(channels, targetDb = -1) {
  const peak = peakOf(channels);
  if (peak === 0) return channels;
  const gain = Math.pow(10, targetDb / 20) / peak;
  return channels.map((d) => {
    const o = new Float32Array(d.length);
    for (let i = 0; i < d.length; i++) o[i] = d[i] * gain;
    return o;
  });
}

/** チャンネル配列 -> 16bit PCM WAV */
export function encodeWav(channels, sampleRate) {
  const numCh = channels.length;
  const frames = channels[0].length;
  const bytes = frames * numCh * 2 + 44;
  const out = new ArrayBuffer(bytes);
  const view = new DataView(out);
  const write = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  write(0, "RIFF");
  view.setUint32(4, bytes - 8, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, bytes - 44, true);

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const s = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return out;
}

/**
 * 波形の客観指標。耳の代わりにはならないが「潰れている / 長すぎる / 明るすぎる」の
 * 判断材料にはなる。
 */
export function analyze(channels, sampleRate) {
  const d = channels[0];
  let peak = 0;
  let sumSq = 0;
  let crossings = 0;
  let prev = 0;
  for (let i = 0; i < d.length; i++) {
    const v = d[i];
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sumSq += v * v;
    if ((v >= 0) !== (prev >= 0)) crossings++;
    prev = v;
  }
  const db = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
  return {
    peakDb: db(peak),
    rmsDb: db(Math.sqrt(sumSq / d.length)),
    clipped: peak >= 0.999,
    seconds: d.length / sampleRate,
    // ゼロクロス率。高いほど高域が強い＝明るい音の目安（FFTの代用）
    zeroCrossRate: (crossings * sampleRate) / d.length,
  };
}
