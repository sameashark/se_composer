#!/usr/bin/env node
/**
 * プリセットJSON -> WAV。
 *   node cli/render.mjs <入力...> [-o out.wav] [-d 出力先] [--play] [--normalize [dB]] [--no-trim] [--json]
 *
 * 入力にはプリセットJSON、それが入ったディレクトリ、インラインJSON文字列を渡せる。
 * ディレクトリを渡すと中の *.json をまとめて書き出す。
 */
import { readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from "node:fs";
import { dirname, resolve, basename, extname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { OfflineAudioContext } from "node-web-audio-api";
import { normalizePreset, estimateDuration, schedule } from "../src/core/engine.js";
import { toChannels, trimTail, normalize, encodeWav, analyze } from "../src/core/wav.js";

const SAMPLE_RATE = 44100;

function parseArgs(argv) {
  const opts = { inputs: [], out: null, outDir: null, play: false, json: false, trim: true, normalizeDb: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o" || a === "--out") opts.out = argv[++i];
    else if (a === "-d" || a === "--outdir") opts.outDir = argv[++i];
    else if (a === "--play" || a === "-p") opts.play = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--no-trim") opts.trim = false;
    else if (a === "--normalize" || a === "-n") {
      const next = argv[i + 1];
      opts.normalizeDb = next !== undefined && next !== "" && !Number.isNaN(Number(next)) ? Number(argv[++i]) : -1;
    } else opts.inputs.push(a);
  }
  return opts;
}

const isInline = (input) => input.trim().startsWith("{");

/** ディレクトリ指定は中の *.json に展開する */
function expandInputs(inputs) {
  const out = [];
  for (const input of inputs) {
    if (isInline(input)) {
      out.push({ source: input, name: "se", inline: true });
      continue;
    }
    const path = resolve(input);
    if (statSync(path).isDirectory()) {
      for (const entry of readdirSync(path).sort()) {
        if (extname(entry).toLowerCase() === ".json") {
          out.push({ source: join(path, entry), name: basename(entry, extname(entry)), inline: false });
        }
      }
    } else {
      out.push({ source: path, name: basename(path, extname(path)), inline: false });
    }
  }
  return out;
}

const loadPreset = (item) => JSON.parse(item.inline ? item.source : readFileSync(item.source, "utf8"));

/** Windows 標準の SoundPlayer。再生完了までブロックする。 */
const play = (file) =>
  spawnSync(
    "powershell",
    ["-NoProfile", "-Command", `(New-Object System.Media.SoundPlayer '${file}').PlaySync()`],
    { stdio: "ignore" }
  ).status === 0;

async function renderOne(item, outPath, opts) {
  const { params, notes, skipped } = normalizePreset(loadPreset(item));
  if (notes.length === 0) {
    throw new Error(`鳴らせるノートがありません${skipped > 0 ? `（pitch が無いノート ${skipped} 件を除外）` : ""}`);
  }

  const ctx = new OfflineAudioContext(1, Math.ceil(SAMPLE_RATE * estimateDuration(params, notes)), SAMPLE_RATE);
  schedule(ctx, params, notes, ctx.destination, 0);

  let channels = toChannels(await ctx.startRendering());
  if (opts.trim) channels = trimTail(channels, SAMPLE_RATE);
  if (opts.normalizeDb !== null) channels = normalize(channels, opts.normalizeDb);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, Buffer.from(encodeWav(channels, SAMPLE_RATE)));

  return { out: outPath, params, notes, skipped, stats: analyze(channels, SAMPLE_RATE) };
}

function report(result, showName) {
  const f = (n, d = 2) => n.toFixed(d);
  const { stats, params, skipped } = result;
  const head = showName ? `${basename(result.out)}  ` : "";
  console.log(
    `${head}${params.oscillatorType} / ${f(stats.seconds)}s / peak ${f(stats.peakDb, 1)}dB / rms ${f(
      stats.rmsDb,
      1
    )}dB / zcr ${Math.round(stats.zeroCrossRate)}Hz${stats.clipped ? "  [CLIPPED]" : ""}${
      skipped > 0 ? `  (pitch なし ${skipped} 件を除外)` : ""
    }`
  );
  if (!showName) console.log(`out   : ${result.out}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.inputs.length === 0) {
    console.error(
      "usage: node cli/render.mjs <preset.json|ディレクトリ|inline json ...> [-o out.wav] [-d 出力先] [--play] [--normalize [dB]] [--no-trim] [--json]"
    );
    process.exit(1);
  }

  const items = expandInputs(opts.inputs);
  if (items.length === 0) {
    console.error("プリセットJSONが見つかりません");
    process.exit(1);
  }
  if (opts.out && items.length > 1) {
    console.error("-o は入力が1つのときだけ使えます。複数まとめて出すときは -d を使ってください");
    process.exit(1);
  }

  const results = [];
  let failed = 0;
  for (const item of items) {
    const outPath = opts.out
      ? resolve(opts.out)
      : resolve(opts.outDir ? join(opts.outDir, `${item.name}.wav`) : `out/${item.name}.wav`);
    try {
      results.push(await renderOne(item, outPath, opts));
    } catch (e) {
      console.error(`${item.name}: ${e.message}`);
      failed++;
    }
  }

  if (opts.json) {
    console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
  } else {
    const multi = items.length > 1;
    if (multi) console.log(`${results.length} 件を書き出しました -> ${dirname(results[0]?.out ?? "out")}`);
    for (const r of results) report(r, multi);
  }

  if (opts.play) for (const r of results) play(r.out);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
