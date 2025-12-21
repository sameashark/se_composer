import { create } from "zustand";

export interface Note {
  id: string;
  time: string;
  pitch: string;
  width: number;
  velocity: number;
}

export type OscillatorType =
  | "sine"
  | "square"
  | "sawtooth"
  | "triangle"
  | "noise";

export interface Preset {
  version: number;
  name: string;
  params: Record<string, any>;
  notes: Note[];
}

interface HistorySnapshot {
  params: {
    bpm: number;
    delayFeedback: number;
    filterCutoff: number;
    filterEnvAmount: number;
    oscillatorType: OscillatorType;
    attack: number;
    decay: number;
    sustain: number;
    release: number;
    pitchAmount: number;
    pitchTime: number;
    masterVolume: number;
    repeatSpeed: number;
    arpAmount: number;
  };
  notes: Note[];
}

export const DEFAULT_STATE = {
  bpm: 120,
  delayFeedback: 0.2,
  filterCutoff: 2000,
  filterEnvAmount: 0,
  oscillatorType: "triangle" as OscillatorType,
  attack: 0.01,
  decay: 0.2,
  sustain: 0.2,
  release: 0.2,
  pitchAmount: 0,
  pitchTime: 0.1,
  masterVolume: -6,
  repeatSpeed: 0,
  arpAmount: 0,
};

interface SongState {
  bpm: number;
  notes: Note[];
  delayFeedback: number;
  filterCutoff: number;
  filterEnvAmount: number;
  oscillatorType: OscillatorType;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  pitchAmount: number;
  pitchTime: number;
  masterVolume: number;
  repeatSpeed: number;
  arpAmount: number;
  history: Preset[];
  past: HistorySnapshot[];
  future: HistorySnapshot[];
  setBpm: (bpm: number) => void;
  setOscillatorType: (type: OscillatorType) => void;
  setEnvelope: (
    key: "attack" | "decay" | "sustain" | "release",
    val: number
  ) => void;
  setPitchEffect: (
    key: "pitchAmount" | "pitchTime" | "arpAmount",
    val: number
  ) => void;
  setEffect: (
    key:
      | "delayFeedback"
      | "filterCutoff"
      | "filterEnvAmount"
      | "masterVolume"
      | "repeatSpeed",
    value: number
  ) => void;
  setAllParams: (params: Partial<SongState>) => void;
  addNote: (note: Note) => void;
  updateNote: (id: string, newNote: Partial<Note>) => void;
  removeNote: (id: string) => void;
  clearNotes: () => void;
  setHistory: (history: Preset[]) => void;
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
}

export const useStore = create<SongState>((set, get) => ({
  ...DEFAULT_STATE,
  notes: [],
  history: JSON.parse(localStorage.getItem("se_composer_history") || "[]"),
  past: [],
  future: [],

  setBpm: (bpm) => set({ bpm }),
  setOscillatorType: (type) => set({ oscillatorType: type }),
  setEnvelope: (key, val) => set({ [key]: val }),
  setPitchEffect: (key, val) => set({ [key]: val }),
  setEffect: (key, value) => set({ [key]: value }),
  setAllParams: (params) => set((state) => ({ ...state, ...params })),

  addNote: (note) =>
    set((state) => ({
      notes: state.notes.some(
        (n) => n.time === note.time && n.pitch === note.pitch
      )
        ? state.notes
        : [...state.notes, note],
    })),

  updateNote: (id, newNote) =>
    set((state) => ({
      notes: state.notes.map((n) => (n.id === id ? { ...n, ...newNote } : n)),
    })),

  removeNote: (id) =>
    set((state) => ({ notes: state.notes.filter((n) => n.id !== id) })),

  clearNotes: () => set({ notes: [] }),

  setHistory: (history) => {
    localStorage.setItem("se_composer_history", JSON.stringify(history));
    set({ history });
  },

  // 履歴スタックを作成するヘルパー
  createSnapshot: (): HistorySnapshot => {
    const s = get();
    return {
      params: {
        bpm: s.bpm,
        delayFeedback: s.delayFeedback,
        filterCutoff: s.filterCutoff,
        filterEnvAmount: s.filterEnvAmount,
        oscillatorType: s.oscillatorType,
        attack: s.attack,
        decay: s.decay,
        sustain: s.sustain,
        release: s.release,
        pitchAmount: s.pitchAmount,
        pitchTime: s.pitchTime,
        masterVolume: s.masterVolume,
        repeatSpeed: s.repeatSpeed,
        arpAmount: s.arpAmount,
      },
      notes: JSON.parse(JSON.stringify(s.notes)),
    };
  },

  pushHistory: () => {
    const s = get();
    const snap = (s as any).createSnapshot();
    const last = s.past[s.past.length - 1];

    // 直前と全く同じならスキップ
    if (last && JSON.stringify(last) === JSON.stringify(snap)) return;

    set({
      past: [...s.past.slice(-49), snap],
      future: [],
    });
  },

  undo: () => {
    const s = get();
    if (s.past.length === 0) return;

    const currentSnap = (s as any).createSnapshot();
    const prev = s.past[s.past.length - 1];
    const newPast = s.past.slice(0, -1);

    set({
      ...prev.params,
      notes: prev.notes,
      past: newPast,
      future: [currentSnap, ...s.future.slice(0, 49)],
    });
  },

  redo: () => {
    const s = get();
    if (s.future.length === 0) return;

    const currentSnap = (s as any).createSnapshot();
    const next = s.future[0];
    const newFuture = s.future.slice(1);

    set({
      ...next.params,
      notes: next.notes,
      past: [...s.past.slice(-49), currentSnap],
      future: newFuture,
    });
  },
}));
