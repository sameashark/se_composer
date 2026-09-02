import { create } from "zustand";
import { DEFAULT_PARAMS, normalizePreset } from "./core/engine.js";
import type { SeNote, SeParams } from "./core/engine.js";

export type { SeNote, SeParams, OscillatorKind, LfoTarget } from "./core/engine.js";
export { DEFAULT_PARAMS, OSCILLATOR_TYPES } from "./core/engine.js";

const STORAGE_KEY = "se_composer_history";
const HISTORY_LIMIT = 50;

export interface StoredPreset {
  version: number;
  name: string;
  params: SeParams;
  notes: SeNote[];
}

interface Snapshot {
  params: SeParams;
  notes: SeNote[];
}

interface SongState extends Snapshot {
  /** 保存済みプリセット（localStorage と同期） */
  presets: StoredPreset[];
  past: Snapshot[];
  future: Snapshot[];

  setParam: <K extends keyof SeParams>(key: K, value: SeParams[K]) => void;
  setParams: (params: Partial<SeParams>) => void;
  addNote: (note: SeNote) => void;
  updateNote: (id: string, patch: Partial<SeNote>) => void;
  removeNote: (id: string) => void;
  clearNotes: () => void;
  setNotes: (notes: SeNote[]) => void;

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
        const { params, notes } = normalizePreset(p);
        return { version: 1, name: p.name, params, notes };
      });
  } catch {
    return [];
  }
}

const snapshotOf = (s: Snapshot): Snapshot => ({
  params: { ...s.params },
  notes: s.notes.map((n) => ({ ...n })),
});

export const useStore = create<SongState>((set, get) => ({
  params: { ...DEFAULT_PARAMS },
  notes: [],
  presets: readStoredPresets(),
  past: [],
  future: [],

  setParam: (key, value) => set((s) => ({ params: { ...s.params, [key]: value } })),
  setParams: (params) => set((s) => ({ params: { ...s.params, ...params } })),

  addNote: (note) =>
    set((s) =>
      s.notes.some((n) => n.time === note.time && n.pitch === note.pitch)
        ? s
        : { notes: [...s.notes, note] }
    ),
  updateNote: (id, patch) =>
    set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) })),
  removeNote: (id) => set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),
  clearNotes: () => set({ notes: [] }),
  setNotes: (notes) => set({ notes }),

  setPresets: (presets) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
    set({ presets });
  },

  loadSnapshot: ({ params, notes }) =>
    set({ params: { ...DEFAULT_PARAMS, ...params }, notes: notes.map((n) => ({ ...n })) }),

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
      past: [...s.past, snapshotOf(s)].slice(-HISTORY_LIMIT),
      future: s.future.slice(1),
    });
  },
}));
