import { create } from "zustand";
import { DEFAULT_PARAMS, normalizePreset, timeToStep } from "./core/engine.js";
import type { SeNote, SeParams } from "./core/engine.js";

export type { SeNote, SeParams, OscillatorKind, LfoTarget } from "./core/engine.js";
export { DEFAULT_PARAMS, OSCILLATOR_TYPES } from "./core/engine.js";

const STORAGE_KEY = "se_composer_history";
const CURRENT_KEY = "se_composer_current";
const HISTORY_LIMIT = 50;

export interface StoredPreset {
  version: number;
  name: string;
  params: SeParams;
  notes: SeNote[];
  /** 書き出しの尺（秒）。null なら音が終わるまで */
  exportSeconds: number | null;
}

interface Snapshot {
  params: SeParams;
  notes: SeNote[];
  /** 書き出しの尺（秒）。ループ素材のように長さを揃えたいときだけ使う。null で従来どおり */
  exportSeconds: number | null;
}

const keyOf = (n: SeNote) => `${timeToStep(n.time)}|${n.pitch}`;

interface SongState extends Snapshot {
  /** 保存済みプリセット（localStorage と同期） */
  presets: StoredPreset[];
  /** 選択中・入力中のプリセット名。作業内容と一緒に保存する */
  presetName: string;
  /** ロック中のパラメータ。reset・サンプル・スライダー操作から守られる */
  lockedParams: (keyof SeParams)[];
  /** 切り取ったが、まだ貼っていないノート。次の操作で確定して捨てる */
  pendingCut: SeNote[];
  past: Snapshot[];
  future: Snapshot[];

  setParam: <K extends keyof SeParams>(key: K, value: SeParams[K]) => void;
  setParams: (params: Partial<SeParams>) => void;
  toggleLock: (key: keyof SeParams) => void;
  clearLocks: () => void;
  addNote: (note: SeNote) => void;
  updateNote: (id: string, patch: Partial<SeNote>) => void;
  removeNote: (id: string) => void;
  clearNotes: () => void;
  setNotes: (notes: SeNote[]) => void;
  setExportSeconds: (seconds: number | null) => void;
  cutNotes: (removed: SeNote[], remaining: SeNote[]) => void;

  setPresetName: (name: string) => void;
  setPresets: (presets: StoredPreset[]) => void;
  loadSnapshot: (snapshot: Snapshot) => void;

  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
}

function readStoredPresets(): StoredPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((p): p is StoredPreset => !!p && typeof p.name === "string")
      .map((p) => {
        const { params, notes, exportSeconds } = normalizePreset(p);
        return { version: 1, name: p.name, params, notes, exportSeconds };
      });
  } catch {
    return [];
  }
}

/** 前回の作業内容。リロードで作業が消えるのを防ぐだけの用途なので、壊れていたら黙って捨てる */
function readCurrent(): Snapshot & { presetName: string } {
  const empty = { params: { ...DEFAULT_PARAMS }, notes: [], exportSeconds: null, presetName: "" };
  try {
    const raw = JSON.parse(localStorage.getItem(CURRENT_KEY) ?? "null");
    if (!raw) return empty;
    const { params, notes, exportSeconds } = normalizePreset(raw);
    const presetName = typeof raw.presetName === "string" ? raw.presetName : "";
    // cut は「切って貼る」で一組の操作。貼らずに閉じたぶんは切る前の位置へ戻す
    const pending = Array.isArray(raw.pendingCut) ? normalizePreset({ notes: raw.pendingCut }).notes : [];
    if (pending.length === 0) return { params, notes, exportSeconds, presetName };
    const taken = new Set(notes.map(keyOf));
    return {
      params,
      notes: [...notes, ...pending.filter((n) => !taken.has(keyOf(n)))],
      exportSeconds,
      presetName,
    };
  } catch {
    return empty;
  }
}

const snapshotOf = (s: Snapshot): Snapshot => ({
  params: { ...s.params },
  notes: s.notes.map((n) => ({ ...n })),
  exportSeconds: s.exportSeconds,
});

const restored = readCurrent();

export const useStore = create<SongState>((set, get) => ({
  params: restored.params,
  notes: restored.notes,
  exportSeconds: restored.exportSeconds,
  presets: readStoredPresets(),
  presetName: restored.presetName,
  lockedParams: [],
  pendingCut: [],
  past: [],
  future: [],

  // ロックのガードは UI の disabled ではなくここに置く。reset とサンプルボタンは
  // setParams を通るので、UI 側だけで塞ぐと素通りする
  setParam: (key, value) =>
    set((s) => (s.lockedParams.includes(key) ? s : { params: { ...s.params, [key]: value } })),
  setParams: (patch) =>
    set((s) => {
      const next = { ...s.params };
      for (const key of Object.keys(patch) as (keyof SeParams)[]) {
        if (s.lockedParams.includes(key)) continue;
        const value = patch[key];
        if (value !== undefined) Object.assign(next, { [key]: value });
      }
      return { params: next };
    }),

  toggleLock: (key) =>
    set((s) => ({
      lockedParams: s.lockedParams.includes(key)
        ? s.lockedParams.filter((k) => k !== key)
        : [...s.lockedParams, key],
    })),
  clearLocks: () => set({ lockedParams: [] }),

  // cut 以外でノートが動いたら「次の行動をした」ので、切ったぶんは確定して捨てる
  addNote: (note) =>
    set((s) =>
      s.notes.some((n) => n.time === note.time && n.pitch === note.pitch)
        ? s
        : { notes: [...s.notes, note], pendingCut: [] }
    ),
  updateNote: (id, patch) =>
    set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)), pendingCut: [] })),
  removeNote: (id) => set((s) => ({ notes: s.notes.filter((n) => n.id !== id), pendingCut: [] })),
  clearNotes: () => set({ notes: [], pendingCut: [] }),
  setNotes: (notes) => set({ notes, pendingCut: [] }),
  setExportSeconds: (seconds) => set({ exportSeconds: seconds }),
  cutNotes: (removed, remaining) => set({ notes: remaining, pendingCut: removed }),

  setPresetName: (presetName) => set({ presetName }),

  setPresets: (presets) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
    set({ presets });
  },

  loadSnapshot: ({ params, notes, exportSeconds }) =>
    set({
      params: { ...DEFAULT_PARAMS, ...params },
      notes: notes.map((n) => ({ ...n })),
      exportSeconds,
      pendingCut: [],
    }),

  pushHistory: () => {
    const s = get();
    const snap = snapshotOf(s);
    const last = s.past[s.past.length - 1];
    if (last && JSON.stringify(last) === JSON.stringify(snap)) return;
    set({ past: [...s.past.slice(-(HISTORY_LIMIT - 1)), snap], future: [] });
  },

  undo: () => {
    const s = get();
    const prev = s.past[s.past.length - 1];
    if (!prev) return;
    set({
      ...prev,
      pendingCut: [],
      past: s.past.slice(0, -1),
      future: [snapshotOf(s), ...s.future].slice(0, HISTORY_LIMIT),
    });
  },

  redo: () => {
    const s = get();
    const next = s.future[0];
    if (!next) return;
    set({
      ...next,
      pendingCut: [],
      past: [...s.past, snapshotOf(s)].slice(-HISTORY_LIMIT),
      future: s.future.slice(1),
    });
  },
}));

// 作業内容を自動保存する。undo 履歴は保存しない（サイズが嵩む割に、
// これとクリップボードの保存でリロード事故はほぼ塞がる）
let saveTimer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe((s, prev) => {
  if (
    s.params === prev.params &&
    s.notes === prev.notes &&
    s.exportSeconds === prev.exportSeconds &&
    s.pendingCut === prev.pendingCut &&
    s.presetName === prev.presetName
  )
    return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { params, notes, exportSeconds, pendingCut, presetName } = useStore.getState();
    try {
      localStorage.setItem(
        CURRENT_KEY,
        JSON.stringify({
          params,
          notes,
          pendingCut,
          presetName,
          // プリセットJSONと同じ形で持つ（normalizePreset がそのまま読める）
          export: exportSeconds === null ? undefined : { seconds: exportSeconds },
        })
      );
    } catch {
      // 容量超過などで書けなくても操作は続けられる必要がある
    }
  }, 300);
});
