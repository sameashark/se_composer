import { DEFAULT_PARAMS, normalizePreset } from "./core/engine.js";
import type { SeNote, SeParams } from "./core/engine.js";
import type { StoredPreset } from "./store";

export interface ParsedPresetFile {
  /** ファイルに入っていたプリセット（名前付きのもの） */
  presets: StoredPreset[];
  /** 現在値として読み込むべき内容。無ければ null */
  current: { params: SeParams; notes: SeNote[]; exportSeconds: number | null } | null;
  /** pitch が無くて読み飛ばしたノートの総数 */
  skipped: number;
}

const PARAM_KEYS = Object.keys(DEFAULT_PARAMS);

/**
 * プリセットらしさの判定。
 * normalizePreset は何を渡しても既定値で埋めた結果を返すので、これを通さないと
 * 無関係な JSON から「デフォルト値だけのプリセット」が黙って生まれてしまう。
 */
function looksLikePreset(value: unknown): value is { name?: unknown; params: Record<string, unknown> } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const params = (value as { params?: unknown }).params;
  if (!params || typeof params !== "object" || Array.isArray(params)) return false;
  return PARAM_KEYS.some((key) => key in (params as Record<string, unknown>));
}

const toStored = (name: string, source: unknown) => {
  const { params, notes, exportSeconds, skipped } = normalizePreset(source);
  return { preset: { version: 1, name, params, notes, exportSeconds } as StoredPreset, skipped };
};

/**
 * UI のエクスポート形式（{current, history}）、プリセットの配列、
 * CLI が読む単体プリセット（{name, params, notes}）のいずれかを解釈する。
 * どれでもなければ null。
 */
export function parsePresetFile(data: unknown): ParsedPresetFile | null {
  if (looksLikePreset(data)) {
    const rawName = (data as { name?: unknown }).name;
    const name = typeof rawName === "string" && rawName.trim() ? rawName.trim() : "untitled";
    const { preset, skipped } = toStored(name, data);
    return {
      presets: [preset],
      current: { params: preset.params, notes: preset.notes, exportSeconds: preset.exportSeconds },
      skipped,
    };
  }

  const rawList = Array.isArray(data) ? data : (data as { history?: unknown })?.history;
  const rawCurrent = (data as { current?: unknown })?.current;
  // history が無く current だけのファイルも読める
  if (!Array.isArray(rawList) && !looksLikePreset(rawCurrent)) return null;

  let skipped = 0;
  const presets: StoredPreset[] = [];
  if (Array.isArray(rawList)) {
    for (const entry of rawList) {
      if (!looksLikePreset(entry)) continue;
      const rawName = (entry as { name?: unknown }).name;
      if (typeof rawName !== "string" || !rawName.trim()) continue;
      const result = toStored(rawName.trim(), entry);
      skipped += result.skipped;
      presets.push(result.preset);
    }
  }

  let current: ParsedPresetFile["current"] = null;
  if (looksLikePreset(rawCurrent)) {
    const normalized = normalizePreset(rawCurrent);
    skipped += normalized.skipped;
    current = {
      params: normalized.params,
      notes: normalized.notes,
      exportSeconds: normalized.exportSeconds,
    };
  }

  // 配列ではあったが中身が1件もプリセットでなければ、無関係なファイルとみなす
  if (presets.length === 0 && !current) return null;

  return { presets, current, skipped };
}

export interface MergeResult {
  presets: StoredPreset[];
  added: number;
  renamed: number;
}

/**
 * 既存リストの末尾に追加する。名前が衝突したら "名前 (2)" のように振り直す。
 * 上書きにすると件数が期待どおり増えず、元データも失われるため。
 */
export function mergePresets(existing: StoredPreset[], incoming: StoredPreset[]): MergeResult {
  const used = new Set(existing.map((p) => p.name));
  const presets = [...existing];
  let renamed = 0;

  for (const preset of incoming) {
    let name = preset.name;
    if (used.has(name)) {
      let n = 2;
      while (used.has(`${name} (${n})`)) n++;
      name = `${name} (${n})`;
      renamed++;
    }
    used.add(name);
    presets.push({ ...preset, name });
  }

  return { presets, added: incoming.length, renamed };
}
