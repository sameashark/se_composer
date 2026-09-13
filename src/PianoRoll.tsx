import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CircleHelp, X } from "lucide-react";
import { useStore } from "./store";
import { newNoteId } from "./randomize";
import { peekContext } from "./audio/player";
import { DELAY_TIME, normalizePreset } from "./core/engine.js";
import type { SeNote } from "./core/engine.js";
import { color, modal, overlay } from "./ui/styles";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const LOW_OCTAVE = 2;
const HIGH_OCTAVE = 7; // C7 まで

/** 低い順。表示は上下反転して高音を上にする。 */
const ALL_PITCHES: string[] = (() => {
  const out: string[] = [];
  for (let oct = LOW_OCTAVE; oct <= HIGH_OCTAVE; oct++) {
    for (const n of NOTE_NAMES) {
      out.push(`${n}${oct}`);
      if (oct === HIGH_OCTAVE) return out; // C7 で打ち切り
    }
  }
  return out;
})();

const isBlackKey = (pitch: string) => pitch.includes("#");
const WHITE_PITCHES = ALL_PITCHES.filter((p) => !isBlackKey(p));

const STEPS = 32; // 16分音符32個 = 2小節
const CELL_W = 28;
const ROW_H = 14;
const KEY_W = 46;
const VIEW_H = 400;
const CANVAS_W = STEPS * CELL_W;

/** この距離を超えるまでドラッグと見なさない。クリック＝配置と範囲選択を分ける */
const DRAG_THRESHOLD = 3;

const CLIPBOARD_KEY = "se_composer_clipboard";

const timeToStep = (time: string | number): number => {
  if (typeof time === "number") return time;
  const p = String(time).split(":").map(Number);
  if (p.length === 3) return p[0] * 16 + p[1] * 4 + p[2];
  if (p.length === 2) return p[0] * 4 + p[1];
  return p[0] || 0;
};

const stepToTime = (step: number) => `${Math.floor(step / 16)}:${Math.floor((step % 16) / 4)}:${step % 4}`;

/** 同じ時刻・同じ音程は1つしか置けない。置き換えの判定に使う */
const keyOf = (n: SeNote) => `${timeToStep(n.time)}|${n.pitch}`;

/**
 * cut したまま貼らずにリロードしても戻せるよう、クリップボードは localStorage に置く。
 * 削除と貼り付けは意思を伴うので直後の状態が正しいが、cut だけは宙ぶらりんになる。
 */
function readClipboard(): SeNote[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CLIPBOARD_KEY) ?? "null");
    if (!Array.isArray(raw)) return [];
    return normalizePreset({ notes: raw }).notes;
  } catch {
    return [];
  }
}

let clipboard: SeNote[] = readClipboard();

function writeClipboard(notes: SeNote[]) {
  clipboard = notes;
  try {
    localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(notes));
  } catch {
    // 容量超過などで書けなくても、そのセッション中は変数側で動く
  }
}

/** ノート群をまとめてずらすときの、グリッドからはみ出さない移動量 */
function clampOffset(
  items: { step: number; width: number; idx: number }[],
  pitchCount: number,
  dStep: number,
  dIdx: number
) {
  let minStep = Infinity;
  let maxEnd = -Infinity;
  let minIdx = Infinity;
  let maxIdx = -Infinity;
  for (const i of items) {
    if (i.step < minStep) minStep = i.step;
    if (i.step + i.width > maxEnd) maxEnd = i.step + i.width;
    if (i.idx < minIdx) minIdx = i.idx;
    if (i.idx > maxIdx) maxIdx = i.idx;
  }
  return {
    dStep: Math.max(-minStep, Math.min(STEPS - maxEnd, dStep)),
    dIdx: Math.max(-minIdx, Math.min(pitchCount - 1 - maxIdx, dIdx)),
  };
}

/** mousedown では確定させず、3px 動いた時点で何のドラッグかを決める */
type Gesture =
  | { kind: "pending"; x: number; y: number; cx: number; cy: number; step: number; row: number; hitId: string | null }
  | { kind: "resize"; id: string }
  | { kind: "marquee"; x0: number; y0: number; x1: number; y1: number }
  | { kind: "move"; step0: number; row0: number; dStep: number; dRow: number };

const SHORTCUTS: { title: string; rows: [string, string][] }[] = [
  {
    title: "マウス",
    rows: [
      ["クリック", "ノートを置く"],
      ["空白をドラッグ", "範囲選択"],
      ["選択をドラッグ", "選択したノートをまとめて移動"],
      ["ノートをドラッグ", "長さを変える"],
      ["ホイール", "強さ（velocity）を変える"],
      ["右クリック", "ノートなら削除、空白なら選択解除"],
    ],
  },
  {
    title: "キーボード",
    rows: [
      ["Ctrl + C / X / V", "コピー / 切り取り / カーソル位置に貼り付け"],
      ["Delete", "選択したノートを削除"],
      ["Esc", "選択解除"],
      ["Space", "再生"],
      ["Ctrl + Z / Y", "元に戻す / やり直す"],
    ],
  },
  {
    title: "タッチ",
    rows: [
      ["タップ", "ノートを置く"],
      ["ダブルタップ", "ノートを削除"],
      ["ドラッグ", "長さを変える"],
    ],
  },
];

/** 再生中の区間（AudioContext の currentTime 基準） */
export interface PlaybackRange {
  startAt: number;
  endAt: number;
}

interface PianoRollProps {
  playback: PlaybackRange | null;
}

export const PianoRoll: React.FC<PianoRollProps> = ({ playback }) => {
  const notes = useStore((s) => s.notes);
  const bpm = useStore((s) => s.params.bpm);
  const addNote = useStore((s) => s.addNote);
  const updateNote = useStore((s) => s.updateNote);
  const removeNote = useStore((s) => s.removeNote);
  const setNotes = useStore((s) => s.setNotes);
  const cutNotes = useStore((s) => s.cutNotes);
  const pushHistory = useStore((s) => s.pushHistory);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef(notes);
  notesRef.current = notes;

  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [showSharps, setShowSharps] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const lastTapRef = useRef(0);
  const lockRef = useRef(false);

  const gestureRef = useRef(gesture);
  gestureRef.current = gesture;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  /** 貼り付け位置。canvas から出ても最後の位置を覚えておく */
  const cursorRef = useRef<{ step: number; idx: number } | null>(null);

  // ♯のノートを持つ譜面では隠すと編集できなくなるので、その場合は常に表示する
  const hasSharpNote = notes.some((n) => isBlackKey(n.pitch));
  const sharpsVisible = showSharps || hasSharpNote;

  const pitches = useMemo(() => (sharpsVisible ? ALL_PITCHES : WHITE_PITCHES), [sharpsVisible]);
  const canvasH = pitches.length * ROW_H;
  const rowOf = useCallback((pitchIndex: number) => pitches.length - 1 - pitchIndex, [pitches]);
  const pitchesRef = useRef(pitches);
  pitchesRef.current = pitches;

  // 起動時と表示切替時は C4 付近を映す（全鍵は画面に入らない）
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = Math.max(0, rowOf(pitches.indexOf("C4")) * ROW_H - VIEW_H / 2);
  }, [pitches, rowOf]);

  const hitTest = useCallback(
    (step: number, pitch: string) =>
      notesRef.current.find((n) => {
        const start = timeToStep(n.time);
        return n.pitch === pitch && step >= start && step < start + n.width;
      }),
    []
  );

  /** canvas 左上を原点とした座標。グリッド外でも返す（矩形やドラッグは外に出る） */
  const canvasPoint = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  /** グリッド内のセル。外なら null */
  const posFromEvent = useCallback(
    (clientX: number, clientY: number) => {
      const { x, y } = canvasPoint(clientX, clientY);
      const step = Math.floor(x / CELL_W);
      const row = Math.floor(y / ROW_H);
      if (step < 0 || step >= STEPS || row < 0 || row >= pitches.length) return null;
      return { step, row, pitch: pitches[pitches.length - 1 - row] };
    },
    [canvasPoint, pitches]
  );

  const resize = useCallback(
    (clientX: number, id: string) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const note = notesRef.current.find((n) => n.id === id);
      if (!note) return;
      const start = timeToStep(note.time);
      const width = Math.max(
        1,
        Math.min(STEPS - start, Math.round((clientX - rect.left - start * CELL_W) / CELL_W))
      );
      if (width !== note.width) updateNote(id, { width });
    },
    [updateNote]
  );

  /** 選択ノートのうち、今の表示に出ているものと、その位置 */
  const selectedItems = useCallback(() => {
    const list = pitchesRef.current;
    return notesRef.current
      .filter((n) => selectionRef.current.has(n.id))
      .map((n) => ({ note: n, step: timeToStep(n.time), width: n.width, idx: list.indexOf(n.pitch) }))
      .filter((x) => x.idx >= 0);
  }, []);

  const deleteSelected = useCallback(() => {
    if (selectionRef.current.size === 0) return;
    pushHistory();
    setNotes(notesRef.current.filter((n) => !selectionRef.current.has(n.id)));
    setSelection(new Set());
  }, [pushHistory, setNotes]);

  const paste = useCallback(() => {
    const cursor = cursorRef.current;
    if (!cursor || clipboard.length === 0) return;
    const list = pitchesRef.current;
    const items = clipboard
      .map((n) => ({ note: n, step: timeToStep(n.time), width: n.width, idx: list.indexOf(n.pitch) }))
      .filter((x) => x.idx >= 0);
    if (items.length === 0) return;

    // クリップボードの左上（最も早く、最も高い音）をカーソル位置に合わせる
    const minStep = Math.min(...items.map((x) => x.step));
    const maxIdx = Math.max(...items.map((x) => x.idx));
    const { dStep, dIdx } = clampOffset(items, list.length, cursor.step - minStep, cursor.idx - maxIdx);

    const pasted: SeNote[] = items.map((x) => ({
      id: newNoteId(),
      time: stepToTime(x.step + dStep),
      pitch: list[x.idx + dIdx],
      width: x.width,
      velocity: x.note.velocity,
    }));
    const keys = new Set(pasted.map(keyOf));
    pushHistory();
    setNotes([...notesRef.current.filter((n) => !keys.has(keyOf(n))), ...pasted]);
    setSelection(new Set(pasted.map((p) => p.id)));
  }, [pushHistory, setNotes]);

  const commitMove = useCallback(
    (g: Extract<Gesture, { kind: "move" }>) => {
      const items = selectedItems();
      if (items.length === 0) return;
      const list = pitchesRef.current;
      const { dStep, dIdx } = clampOffset(items, list.length, g.dStep, -g.dRow);
      if (dStep === 0 && dIdx === 0) return;

      const moved: SeNote[] = items.map((x) => ({
        ...x.note,
        time: stepToTime(x.step + dStep),
        pitch: list[x.idx + dIdx],
      }));
      const keys = new Set(moved.map(keyOf));
      pushHistory();
      setNotes([
        ...notesRef.current.filter((n) => !selectionRef.current.has(n.id) && !keys.has(keyOf(n))),
        ...moved,
      ]);
    },
    [pushHistory, selectedItems, setNotes]
  );

  // ドラッグ中だけ window で拾う。canvas の外へ出てもジェスチャを続けられる
  const dragging = gesture !== null;
  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: MouseEvent) => {
      const g = gestureRef.current;
      if (!g) return;

      if (g.kind === "pending") {
        if (Math.abs(e.clientX - g.x) < DRAG_THRESHOLD && Math.abs(e.clientY - g.y) < DRAG_THRESHOLD) return;
        if (g.hitId === null) {
          setSelection(new Set());
          const p = canvasPoint(e.clientX, e.clientY);
          setGesture({ kind: "marquee", x0: g.cx, y0: g.cy, x1: p.x, y1: p.y });
        } else if (selectionRef.current.has(g.hitId)) {
          setGesture({ kind: "move", step0: g.step, row0: g.row, dStep: 0, dRow: 0 });
        } else {
          // 未選択ノートのドラッグは従来どおり幅の変更。履歴は実際に動いたここで積む
          pushHistory();
          setSelection(new Set());
          setGesture({ kind: "resize", id: g.hitId });
        }
        return;
      }

      if (g.kind === "resize") {
        resize(e.clientX, g.id);
      } else if (g.kind === "marquee") {
        const p = canvasPoint(e.clientX, e.clientY);
        setGesture({ ...g, x1: p.x, y1: p.y });
      } else {
        const p = canvasPoint(e.clientX, e.clientY);
        setGesture({
          ...g,
          dStep: Math.floor(p.x / CELL_W) - g.step0,
          dRow: Math.floor(p.y / ROW_H) - g.row0,
        });
      }
    };

    const onUp = () => {
      const g = gestureRef.current;
      setGesture(null);
      if (!g) return;

      if (g.kind === "pending") {
        // 押して動かさずに離した＝クリック
        if (g.hitId) {
          setSelection(new Set([g.hitId]));
        } else {
          pushHistory();
          const list = pitchesRef.current;
          addNote({
            id: newNoteId(),
            time: stepToTime(g.step),
            pitch: list[list.length - 1 - g.row],
            width: 1,
            velocity: 0.8,
          });
          setSelection(new Set());
        }
      } else if (g.kind === "marquee") {
        const x0 = Math.min(g.x0, g.x1);
        const x1 = Math.max(g.x0, g.x1);
        const y0 = Math.min(g.y0, g.y1);
        const y1 = Math.max(g.y0, g.y1);
        const list = pitchesRef.current;
        const ids = notesRef.current
          .filter((n) => {
            const idx = list.indexOf(n.pitch);
            if (idx < 0) return false;
            const nx = timeToStep(n.time) * CELL_W;
            const ny = (list.length - 1 - idx) * ROW_H;
            return nx < x1 && nx + n.width * CELL_W > x0 && ny < y1 && ny + ROW_H > y0;
          })
          .map((n) => n.id);
        setSelection(new Set(ids));
      } else if (g.kind === "move") {
        commitMove(g);
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [addNote, canvasPoint, commitMove, dragging, pushHistory, resize]);

  // 右クリック削除や undo で消えたノートの id を選択から落とす
  useEffect(() => {
    setSelection((prev) => {
      if (prev.size === 0) return prev;
      const alive = new Set(notes.map((n) => n.id));
      const next = new Set<string>();
      for (const id of prev) if (alive.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [notes]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
      const meta = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (helpOpen) {
        if (key === "escape") setHelpOpen(false);
        return;
      }

      if (meta && (key === "c" || key === "x")) {
        const picked = notesRef.current.filter((n) => selectionRef.current.has(n.id));
        if (picked.length === 0) return;
        e.preventDefault();
        writeClipboard(picked.map((n) => ({ ...n })));
        if (key === "x") {
          pushHistory();
          // 「切って貼る」で一組なので、貼らずに終わった場合に備えて切った中身を残す
          cutNotes(picked, notesRef.current.filter((n) => !selectionRef.current.has(n.id)));
          setSelection(new Set());
        }
      } else if (meta && key === "v") {
        e.preventDefault();
        paste();
      } else if (key === "delete" || key === "backspace") {
        if (selectionRef.current.size === 0) return;
        e.preventDefault();
        deleteSelected();
      } else if (key === "escape") {
        setSelection(new Set());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cutNotes, deleteSelected, helpOpen, paste, pushHistory]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    for (let i = 0; i < pitches.length; i++) {
      const pitch = pitches[pitches.length - 1 - i];
      ctx.fillStyle = isBlackKey(pitch) ? "#070d1a" : "#0f172a";
      ctx.fillRect(0, i * ROW_H, CANVAS_W, ROW_H);
    }

    ctx.lineWidth = 1;
    for (let i = 0; i <= pitches.length; i++) {
      // オクターブの境目（C の下端）を強調すると音程を数えやすい
      const below = pitches[pitches.length - 1 - i];
      ctx.strokeStyle = below && below.startsWith("C") && !isBlackKey(below) ? "#3f4d63" : "#1e293b";
      ctx.beginPath();
      ctx.moveTo(0, i * ROW_H + 0.5);
      ctx.lineTo(CANVAS_W, i * ROW_H + 0.5);
      ctx.stroke();
    }
    for (let s = 0; s <= STEPS; s++) {
      ctx.strokeStyle = s % 16 === 0 ? "#475569" : s % 4 === 0 ? "#334155" : "#1e293b";
      ctx.beginPath();
      ctx.moveTo(s * CELL_W + 0.5, 0);
      ctx.lineTo(s * CELL_W + 0.5, canvasH);
      ctx.stroke();
    }

    // 移動中は store を触らず、描画側でずらして見せる
    let offset: { dStep: number; dIdx: number } | null = null;
    if (gesture?.kind === "move") {
      const items = notes
        .filter((n) => selection.has(n.id))
        .map((n) => ({ step: timeToStep(n.time), width: n.width, idx: pitches.indexOf(n.pitch) }))
        .filter((x) => x.idx >= 0);
      if (items.length > 0) offset = clampOffset(items, pitches.length, gesture.dStep, -gesture.dRow);
    }
    const resizeId = gesture?.kind === "resize" ? gesture.id : null;

    for (const note of notes) {
      const pitchIndex = pitches.indexOf(note.pitch);
      if (pitchIndex < 0) continue; // 表示範囲外（件数は下に出す）
      const selected = selection.has(note.id);
      const step = timeToStep(note.time) + (selected && offset ? offset.dStep : 0);
      const idx = pitchIndex + (selected && offset ? offset.dIdx : 0);
      const x = step * CELL_W + 1;
      const y = rowOf(idx) * ROW_H + 1;
      // canvas には CSS の :hover が効かないので、ボタン類と同じ 0.75 を自前で当てる
      ctx.globalAlpha = note.id === hoverId ? 0.75 : 1;
      ctx.fillStyle = `rgba(59, 130, 246, ${0.35 + 0.55 * Math.min(1, note.velocity)})`;
      ctx.strokeStyle = selected || note.id === resizeId ? "#f8fafc" : "#60a5fa";
      ctx.lineWidth = selected ? 2 : 1;
      ctx.fillRect(x, y, note.width * CELL_W - 2, ROW_H - 2);
      ctx.strokeRect(x, y, note.width * CELL_W - 2, ROW_H - 2);
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;

    if (gesture?.kind === "marquee") {
      const x = Math.min(gesture.x0, gesture.x1);
      const y = Math.min(gesture.y0, gesture.y1);
      const w = Math.abs(gesture.x1 - gesture.x0);
      const h = Math.abs(gesture.y1 - gesture.y0);
      ctx.fillStyle = "rgba(59, 130, 246, 0.15)";
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "#60a5fa";
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(x + 0.5, y + 0.5, w, h);
      ctx.setLineDash([]);
    }
  }, [notes, gesture, selection, hoverId, pitches, canvasH, rowOf]);

  // 再生カーソル。毎フレーム state を更新すると再描画が走るので、DOM を直接動かす
  useEffect(() => {
    const el = playheadRef.current;
    if (!el) return;
    const hide = () => {
      el.style.display = "none";
    };
    if (!playback) {
      hide();
      return;
    }

    const stepSec = 60 / bpm / 4;
    let raf = 0;
    const tick = () => {
      const ctx = peekContext();
      if (!ctx) {
        hide();
        return;
      }
      // 原音もディレイラインを通るため発音全体が DELAY_TIME 遅れる。
      // カーソルを譜面時刻のまま走らせるとノートの頭で音が鳴っておらず気持ち悪いので、
      // 実際に聞こえている位置に合わせる（DAW のプラグイン遅延補償にあたる）
      const elapsed = ctx.currentTime - playback.startAt - DELAY_TIME;
      const step = elapsed / stepSec;
      if (elapsed < 0 || step > STEPS) hide();
      else {
        el.style.display = "block";
        el.style.transform = `translateX(${step * CELL_W}px)`;
      }
      if (ctx.currentTime < playback.endAt) raf = requestAnimationFrame(tick);
      else hide();
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      hide();
    };
  }, [playback, bpm]);

  /** タッチは従来のまま。触れた瞬間に配置・リサイズし、ダブルタップで削除する */
  const startTouch = (clientX: number, clientY: number) => {
    if (lockRef.current) return;
    const pos = posFromEvent(clientX, clientY);
    if (!pos) return;
    const hit = hitTest(pos.step, pos.pitch);

    if (hit) {
      const now = Date.now();
      if (now - lastTapRef.current < 300) {
        pushHistory();
        removeNote(hit.id);
        lastTapRef.current = 0;
        // 削除直後の再配置が暴発しないよう、ダブルタップ判定より少し長くロックする
        lockRef.current = true;
        setTimeout(() => (lockRef.current = false), 350);
        return;
      }
      lastTapRef.current = now;
      pushHistory();
      setGesture({ kind: "resize", id: hit.id });
      return;
    }

    pushHistory();
    addNote({ id: newNoteId(), time: stepToTime(pos.step), pitch: pos.pitch, width: 1, velocity: 0.8 });
  };

  const outOfRange = notes.filter((n) => pitches.indexOf(n.pitch) < 0);

  return (
    <div>
      {helpOpen && (
        <div style={overlay} onClick={() => setHelpOpen(false)}>
          <div
            style={{ ...modal, textAlign: "left", maxWidth: 560, width: "90%", maxHeight: "80vh", overflowY: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1 }}>操作とショートカット</span>
              <button
                onClick={() => setHelpOpen(false)}
                title="閉じる (Esc)"
                style={{
                  display: "inline-flex",
                  background: "transparent",
                  color: color.muted,
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                }}
              >
                <X size={16} />
              </button>
            </div>
            {SHORTCUTS.map((group) => (
              <div key={group.title} style={{ marginBottom: 14 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 1.5,
                    color: color.accent,
                    marginBottom: 4,
                  }}
                >
                  {group.title}
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <tbody>
                    {group.rows.map(([keys, description]) => (
                      <tr key={keys}>
                        <td
                          style={{
                            width: 1,
                            whiteSpace: "nowrap",
                            verticalAlign: "top",
                            padding: "3px 14px 3px 0",
                          }}
                        >
                          {keys}
                        </td>
                        <td style={{ padding: "3px 0", color: color.muted }}>{description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        style={{
          display: "flex",
          // stretch のままだと canvas の高さが maxHeight に潰され、
          // 描画が縦に圧縮されてクリック座標と合わなくなる
          alignItems: "flex-start",
          maxHeight: VIEW_H,
          overflowY: "auto",
          overflowX: "auto",
          background: "#0f172a",
          borderRadius: 8,
          border: "1px solid #334155",
          touchAction: "none",
        }}
      >
        <div style={{ width: KEY_W, height: canvasH, flexShrink: 0, position: "sticky", left: 0, zIndex: 1 }}>
          {pitches
            .slice()
            .reverse()
            .map((p) => {
              const black = isBlackKey(p);
              return (
                <div
                  key={p}
                  style={{
                    // border を含めて ROW_H に収める。崩れると canvas の行と1pxずつずれる
                    boxSizing: "border-box",
                    height: ROW_H,
                    minHeight: ROW_H,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    fontSize: 9,
                    fontWeight: 600,
                    paddingRight: 5,
                    color: black ? "#94a3b8" : "#1e293b",
                    // 実際のピアノに寄せる。黒鍵は短く、鍵盤側から食い込ませる
                    background: black
                      ? "linear-gradient(to right, #cbd5e1 0 35%, #020617 35% 100%)"
                      : "#cbd5e1",
                    borderBottom: black ? "1px solid #020617" : "1px solid #94a3b8",
                    borderRight: "1px solid #334155",
                  }}
                >
                  {black ? "" : p.startsWith("C") ? p : p[0]}
                </div>
              );
            })}
        </div>
        <div style={{ position: "relative", flexShrink: 0 }}>
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={canvasH}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            // preventDefault はテキスト選択を止めるためだが、同時にフォーカス移動も止める。
            // 数値欄にフォーカスが残ったままだと Ctrl+C や Del が入力欄向けと判定されて効かない
            e.preventDefault();
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            const pos = posFromEvent(e.clientX, e.clientY);
            if (!pos) return;
            const point = canvasPoint(e.clientX, e.clientY);
            setGesture({
              kind: "pending",
              x: e.clientX,
              y: e.clientY,
              cx: point.x,
              cy: point.y,
              step: pos.step,
              row: pos.row,
              hitId: hitTest(pos.step, pos.pitch)?.id ?? null,
            });
          }}
          onMouseMove={(e) => {
            const pos = posFromEvent(e.clientX, e.clientY);
            if (pos) cursorRef.current = { step: pos.step, idx: pitches.length - 1 - pos.row };
            if (gesture) return;
            setHoverId(pos ? hitTest(pos.step, pos.pitch)?.id ?? null : null);
          }}
          onMouseLeave={() => setHoverId(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            const pos = posFromEvent(e.clientX, e.clientY);
            if (!pos) return;
            const hit = hitTest(pos.step, pos.pitch);
            if (hit) {
              pushHistory();
              removeNote(hit.id);
            } else {
              setSelection(new Set());
            }
          }}
          onWheel={(e) => {
            // ノート上のホイールは velocity 調整（それ以外はスクロールのまま）
            const pos = posFromEvent(e.clientX, e.clientY);
            if (!pos) return;
            const hit = hitTest(pos.step, pos.pitch);
            if (!hit) return;
            e.stopPropagation();
            const next = Math.max(0.1, Math.min(1, hit.velocity - Math.sign(e.deltaY) * 0.05));
            updateNote(hit.id, { velocity: Number(next.toFixed(2)) });
          }}
          onTouchStart={(e) => {
            const t = e.touches[0];
            if (t) startTouch(t.clientX, t.clientY);
          }}
          onTouchMove={(e) => {
            const t = e.touches[0];
            const g = gestureRef.current;
            if (t && g?.kind === "resize") {
              e.preventDefault();
              resize(t.clientX, g.id);
            }
          }}
          onTouchEnd={() => setGesture(null)}
          // CSS サイズを属性と一致させる。auto のままだと flex や画面幅で伸縮し、
          // 描画スケールとクリック座標の計算がずれる
          style={{ cursor: "pointer", display: "block", width: CANVAS_W, height: canvasH }}
        />
          <div
            ref={playheadRef}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: 2,
              height: canvasH,
              background: "#f8fafc",
              opacity: 0.8,
              pointerEvents: "none",
              display: "none",
              willChange: "transform",
            }}
          />
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          fontSize: 10,
          color: "#64748b",
          padding: "6px 2px",
        }}
      >
        <button
          onClick={() => setHelpOpen(true)}
          title="操作とショートカットの一覧"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            background: "transparent",
            color: "#64748b",
            border: "none",
            padding: 0,
            fontSize: 10,
            cursor: "pointer",
          }}
        >
          <CircleHelp size={13} /> 操作方法
        </button>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {selection.size > 0 && (
            <button
              onClick={() => setSelection(new Set())}
              title="選択を解除する (Esc)"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                background: "transparent",
                color: "#f8fafc",
                border: "1px solid #334155",
                borderRadius: 999,
                padding: "1px 8px",
                fontSize: 10,
                cursor: "pointer",
              }}
            >
              選択 {selection.size} 件 ✕
            </button>
          )}
          {outOfRange.length > 0 && (
            <span style={{ color: "#f59e0b" }}>表示範囲外 {outOfRange.length} 件</span>
          )}
          <label
            style={{ display: "flex", alignItems: "center", gap: 4, cursor: hasSharpNote ? "default" : "pointer" }}
            title={hasSharpNote ? "♯のノートがあるため常に表示します" : "半音（黒鍵）の行を表示する"}
          >
            <input
              type="checkbox"
              checked={sharpsVisible}
              disabled={hasSharpNote}
              onChange={(e) => setShowSharps(e.target.checked)}
            />
            ♯ を表示
          </label>
        </span>
      </div>
    </div>
  );
};
