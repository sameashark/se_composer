import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "./store";
import { newNoteId } from "./randomize";

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

const timeToStep = (time: string | number): number => {
  if (typeof time === "number") return time;
  const p = String(time).split(":").map(Number);
  if (p.length === 3) return p[0] * 16 + p[1] * 4 + p[2];
  if (p.length === 2) return p[0] * 4 + p[1];
  return p[0] || 0;
};

const stepToTime = (step: number) => `${Math.floor(step / 16)}:${Math.floor((step % 16) / 4)}:${step % 4}`;

export const PianoRoll: React.FC = () => {
  const notes = useStore((s) => s.notes);
  const addNote = useStore((s) => s.addNote);
  const updateNote = useStore((s) => s.updateNote);
  const removeNote = useStore((s) => s.removeNote);
  const pushHistory = useStore((s) => s.pushHistory);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef(notes);
  notesRef.current = notes;

  const [dragId, setDragId] = useState<string | null>(null);
  const [showSharps, setShowSharps] = useState(false);
  const lastTapRef = useRef(0);
  const lockRef = useRef(false);

  // ♯のノートを持つ譜面では隠すと編集できなくなるので、その場合は常に表示する
  const hasSharpNote = notes.some((n) => isBlackKey(n.pitch));
  const sharpsVisible = showSharps || hasSharpNote;

  const pitches = useMemo(() => (sharpsVisible ? ALL_PITCHES : WHITE_PITCHES), [sharpsVisible]);
  const canvasH = pitches.length * ROW_H;
  const rowOf = useCallback((pitchIndex: number) => pitches.length - 1 - pitchIndex, [pitches]);

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

  const posFromEvent = useCallback(
    (clientX: number, clientY: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const step = Math.floor((clientX - rect.left) / CELL_W);
      const row = Math.floor((clientY - rect.top) / ROW_H);
      if (step < 0 || step >= STEPS || row < 0 || row >= pitches.length) return null;
      return { step, pitch: pitches[pitches.length - 1 - row] };
    },
    [pitches]
  );

  const startAction = (clientX: number, clientY: number, isTouch: boolean) => {
    if (lockRef.current) return;
    const pos = posFromEvent(clientX, clientY);
    if (!pos) return;
    const hit = hitTest(pos.step, pos.pitch);

    if (hit) {
      if (isTouch) {
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
      }
      pushHistory();
      setDragId(hit.id);
      return;
    }

    pushHistory();
    addNote({ id: newNoteId(), time: stepToTime(pos.step), pitch: pos.pitch, width: 1, velocity: 0.8 });
  };

  const resize = useCallback(
    (clientX: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect || !dragId) return;
      const note = notesRef.current.find((n) => n.id === dragId);
      if (!note) return;
      const start = timeToStep(note.time);
      const width = Math.max(
        1,
        Math.min(STEPS - start, Math.round((clientX - rect.left - start * CELL_W) / CELL_W))
      );
      if (width !== note.width) updateNote(dragId, { width });
    },
    [dragId, updateNote]
  );

  useEffect(() => {
    if (!dragId) return;
    const onMove = (e: MouseEvent) => resize(e.clientX);
    const onUp = () => setDragId(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragId, resize]);

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

    for (const note of notes) {
      const pitchIndex = pitches.indexOf(note.pitch);
      if (pitchIndex < 0) continue; // 表示範囲外（件数は下に出す）
      const x = timeToStep(note.time) * CELL_W + 1;
      const y = rowOf(pitchIndex) * ROW_H + 1;
      ctx.fillStyle = `rgba(59, 130, 246, ${0.35 + 0.55 * Math.min(1, note.velocity)})`;
      ctx.strokeStyle = note.id === dragId ? "#f8fafc" : "#60a5fa";
      ctx.fillRect(x, y, note.width * CELL_W - 2, ROW_H - 2);
      ctx.strokeRect(x, y, note.width * CELL_W - 2, ROW_H - 2);
    }
  }, [notes, dragId, pitches, canvasH, rowOf]);

  const outOfRange = notes.filter((n) => pitches.indexOf(n.pitch) < 0);

  return (
    <div>
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
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={canvasH}
          onMouseDown={(e) => {
            e.preventDefault();
            startAction(e.clientX, e.clientY, false);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            const pos = posFromEvent(e.clientX, e.clientY);
            if (!pos) return;
            const hit = hitTest(pos.step, pos.pitch);
            if (hit) {
              pushHistory();
              removeNote(hit.id);
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
            if (t) startAction(t.clientX, t.clientY, true);
          }}
          onTouchMove={(e) => {
            const t = e.touches[0];
            if (t && dragId) {
              e.preventDefault();
              resize(t.clientX);
            }
          }}
          onTouchEnd={() => setDragId(null)}
          // CSS サイズを属性と一致させる。auto のままだと flex や画面幅で伸縮し、
          // 描画スケールとクリック座標の計算がずれる
          style={{ cursor: "pointer", display: "block", width: CANVAS_W, height: canvasH, flexShrink: 0 }}
        />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          fontSize: 10,
          color: "#64748b",
          padding: "6px 2px",
        }}
      >
        <span>クリック=追加 / ドラッグ=長さ / 右クリック=削除 / ホイール=強さ</span>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
