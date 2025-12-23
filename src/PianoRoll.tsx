// @ts-nocheck
import React, { useRef, useState, useEffect } from "react";
import { useStore, Note } from "./store";

export const PianoRoll: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { notes, addNote, updateNote, removeNote, pushHistory } = useStore();

  const [isResizing, setIsResizing] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  // ダブルタップ判定用のRef
  const lastTapRef = useRef<number>(0);
  // 誤操作防止用のロックRef
  const interactionLockRef = useRef<boolean>(false);

  const GRID_X = 50;
  const GRID_Y = 25;
  const CANVAS_WIDTH = 800;
  const CANVAS_HEIGHT = 250;
  const SCALE = ["B3", "C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5", "D5"];

  const getLocalPos = (e: any) => {
    if (e.touches && e.touches.length > 0) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top,
      };
    }
    if (e.nativeEvent) {
      return {
        x: e.nativeEvent.offsetX,
        y: e.nativeEvent.offsetY,
      };
    }
    return { x: 0, y: 0 };
  };

  const timeToCol = (time: string) => {
    const parts = time.split(":").map(Number);
    return parts[1] * 4 + parts[2];
  };

  const handleActionStart = (
    x: number,
    y: number,
    isTouch: boolean = false
  ) => {
    // ロック中は操作を受け付けない（削除直後の再配置防止）
    if (interactionLockRef.current) return;

    const col = Math.floor(x / GRID_X);
    const row = Math.floor(y / GRID_Y);

    if (row < 0 || row >= SCALE.length) return;

    const pitch = SCALE[SCALE.length - 1 - row];

    const clickedNote = notes.find((n) => {
      const startCol = timeToCol(n.time);
      return n.pitch === pitch && col >= startCol && col < startCol + n.width;
    });

    if (clickedNote) {
      // ダブルタップ判定（タッチ操作のみ）
      if (isTouch) {
        const now = Date.now();
        if (now - lastTapRef.current < 300) {
          // 300ms以内の連打＝削除実行
          pushHistory();
          removeNote(clickedNote.id);
          lastTapRef.current = 0;

          // 削除直後に「新規配置」が暴発しないよう、短時間ロックをかける
          interactionLockRef.current = true;
          setTimeout(() => {
            interactionLockRef.current = false;
          }, 350); // ダブルタップ判定時間より少し長めに設定

          return;
        }
        lastTapRef.current = now;
      }

      pushHistory();
      setActiveId(clickedNote.id);
      setIsResizing(true);
    } else {
      pushHistory();
      const time = `0:${Math.floor(col / 4)}:${col % 4}`;
      addNote({
        id: Math.random().toString(36).substr(2, 9),
        time,
        pitch,
        width: 1,
        velocity: 0.8,
      });
    }
  };

  const handleActionMove = (x: number) => {
    if (!isResizing || !activeId) return;
    const note = notes.find((n) => n.id === activeId);
    if (note) {
      const startX = timeToCol(note.time) * GRID_X;
      const newWidth = Math.max(1, Math.round((x - startX) / GRID_X));
      if (newWidth !== note.width) {
        updateNote(activeId, { width: newWidth });
      }
    }
  };

  const handleActionEnd = () => {
    setIsResizing(false);
    setActiveId(null);
  };

  // --- Mouse Events ---
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const { x, y } = getLocalPos(e);
    handleActionStart(x, y, false);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isResizing) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    handleActionMove(x);
  };

  const handleMouseUp = () => {
    handleActionEnd();
  };

  // --- Touch Events ---
  const handleTouchStart = (e: React.TouchEvent) => {
    // e.preventDefault(); // スクロールは許可しつつ、別途タッチアクション制御
    const { x, y } = getLocalPos(e);
    handleActionStart(x, y, true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    e.preventDefault();
    const { x } = getLocalPos(e);
    handleActionMove(x);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    handleActionEnd();
  };

  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, activeId, notes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Grid
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 1;
    for (let x = 0; x <= CANVAS_WIDTH; x += GRID_X) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_HEIGHT);
      ctx.stroke();
    }
    for (let y = 0; y <= CANVAS_HEIGHT; y += GRID_Y) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(CANVAS_WIDTH, y);
      ctx.stroke();
    }

    // Notes
    notes.forEach((note) => {
      const col = timeToCol(note.time);
      const row = SCALE.length - 1 - SCALE.indexOf(note.pitch);

      ctx.fillStyle = "rgba(59, 130, 246, 0.75)";
      ctx.strokeStyle = "#60a5fa";
      ctx.lineWidth = 1;

      const x = col * GRID_X + 1;
      const y = row * GRID_Y + 1;
      const w = note.width * GRID_X - 2;
      const h = GRID_Y - 2;

      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    });
  }, [notes]);

  return (
    <div
      style={{
        display: "flex",
        background: "#0f172a",
        borderRadius: "8px",
        overflow: "hidden",
        touchAction: "none",
      }}
    >
      <div
        style={{
          width: "50px",
          display: "flex",
          flexDirection: "column-reverse",
          borderRight: "1px solid #334155",
          background: "#1e293b",
        }}
      >
        {SCALE.map((s) => (
          <div
            key={s}
            style={{
              height: "25px",
              fontSize: "10px",
              color: "#94a3b8",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderBottom: "1px solid #0f172a",
              boxSizing: "border-box",
            }}
          >
            {s}
          </div>
        ))}
      </div>
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        onMouseDown={handleMouseDown}
        onContextMenu={(e) => {
          e.preventDefault();
          const { x, y } = getLocalPos(e);
          const col = Math.floor(x / GRID_X);
          const row = Math.floor(y / GRID_Y);
          const pitch = SCALE[SCALE.length - 1 - row];
          const note = notes.find((n) => {
            const startCol = timeToCol(n.time);
            return (
              n.pitch === pitch && col >= startCol && col < startCol + n.width
            );
          });
          if (note) {
            pushHistory();
            removeNote(note.id);
          }
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ cursor: "pointer" }}
      />
    </div>
  );
};
