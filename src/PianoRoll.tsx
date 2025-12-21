import React, { useRef, useState, useEffect } from "react";
import { useStore } from "./store";

export const PianoRoll: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { notes, addNote, updateNote, removeNote, pushHistory } = useStore();

  const [isResizing, setIsResizing] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const GRID_X = 50;
  const GRID_Y = 25;
  const CANVAS_WIDTH = 800;
  const CANVAS_HEIGHT = 250;
  const SCALE = ["B3", "C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5", "D5"];

  const getMousePos = (e: React.MouseEvent | MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return {
      x: e.clientX - (rect?.left || 0),
      y: e.clientY - (rect?.top || 0),
    };
  };

  const timeToCol = (time: string) => {
    const parts = time.split(":").map(Number);
    return parts[1] * 4 + parts[2];
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const { x, y } = getMousePos(e);
    const col = Math.floor(x / GRID_X);
    const row = Math.floor(y / GRID_Y);
    const pitch = SCALE[SCALE.length - 1 - row];

    const clickedNote = notes.find((n) => {
      const startCol = timeToCol(n.time);
      return n.pitch === pitch && col >= startCol && col < startCol + n.width;
    });

    if (clickedNote) {
      pushHistory(); // 変更前に保存
      setActiveId(clickedNote.id);
      setIsResizing(true);
    } else {
      pushHistory(); // 変更前に保存
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

  const handleMouseMove = (e: MouseEvent) => {
    if (!isResizing || !activeId) return;
    const { x } = getMousePos(e as any);
    const note = notes.find((n) => n.id === activeId);
    if (note) {
      const startX = timeToCol(note.time) * GRID_X;
      const newWidth = Math.max(1, Math.round((x - startX) / GRID_X));
      if (newWidth !== note.width) {
        updateNote(activeId, { width: newWidth });
      }
    }
  };

  const handleMouseUp = () => {
    setIsResizing(false);
    setActiveId(null);
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

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.globalAlpha = 1.0;
    for (let i = 0; i <= 16; i++) {
      ctx.beginPath();
      ctx.strokeStyle = i % 4 === 0 ? "#475569" : "#334155";
      ctx.lineWidth = i % 4 === 0 ? 2 : 1;
      ctx.moveTo(i * GRID_X, 0);
      ctx.lineTo(i * GRID_X, CANVAS_HEIGHT);
      ctx.stroke();
    }
    for (let j = 0; j <= SCALE.length; j++) {
      ctx.beginPath();
      ctx.strokeStyle = "#334155";
      ctx.moveTo(0, j * GRID_Y);
      ctx.lineTo(CANVAS_WIDTH, j * GRID_Y);
      ctx.stroke();
    }

    notes.forEach((n) => {
      const col = timeToCol(n.time);
      const row = SCALE.indexOf(n.pitch);
      const x = col * GRID_X;
      const y = CANVAS_HEIGHT - (row + 1) * GRID_Y;

      ctx.globalAlpha = n.id === activeId ? 0.9 : 0.65;
      ctx.fillStyle = n.id === activeId ? "#60a5fa" : "#3b82f6";
      ctx.fillRect(x + 2, y + 2, n.width * GRID_X - 4, GRID_Y - 4);

      ctx.globalAlpha = 1.0;
      ctx.strokeStyle = "#1e40af";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 2, y + 2, n.width * GRID_X - 4, GRID_Y - 4);
    });
  }, [notes, activeId]);

  return (
    <div
      style={{
        display: "flex",
        backgroundColor: "#0f172a",
        borderRadius: "8px",
        overflow: "hidden",
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
          const { x, y } = getMousePos(e);
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
            pushHistory(); // 削除前に保存
            removeNote(note.id);
          }
        }}
        style={{ cursor: "crosshair", display: "block" }}
      />
    </div>
  );
};
