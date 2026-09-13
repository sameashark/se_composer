import React from "react";
import { LockToggle } from "./LockToggle";
import { useStore } from "../store";
import type { SeParams } from "../core/engine.js";
import { color } from "../ui/styles";

interface SliderProps {
  label: string;
  paramKey: keyof SeParams;
  value: number;
  min: number;
  max: number;
  step?: number;
  digits?: number;
  onStart: () => void;
  onChange: (value: number) => void;
  onEnd: () => void;
}

export const Slider: React.FC<SliderProps> = ({
  label,
  paramKey,
  value,
  min,
  max,
  step = 1,
  digits = 2,
  onStart,
  onChange,
  onEnd,
}) => {
  const locked = useStore((s) => s.lockedParams.includes(paramKey));

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: color.muted }}>
        <span style={{ letterSpacing: 1 }}>{label}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <input
            type="number"
            value={Number(value.toFixed(digits))}
            min={min}
            max={max}
            step={step}
            disabled={locked}
            onFocus={onStart}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
            }}
            // blur で鳴らすと、PLAY ボタンを押した瞬間の blur が先に再生を始めてしまい、
            // 続くクリックが STOP と解釈されて鳴らない。確定は Enter に任せる
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onEnd();
              }
            }}
            style={{
              width: 68,
              background: color.bg,
              color: color.text,
              border: `1px solid ${color.border}`,
              borderRadius: 4,
              fontSize: 10,
              padding: "2px 4px",
              textAlign: "right",
              opacity: locked ? 0.45 : 1,
            }}
          />
          <LockToggle paramKey={paramKey} />
        </span>
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={locked}
        onPointerDown={onStart}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onEnd}
        onKeyUp={onEnd}
        style={{
          width: "100%",
          accentColor: locked ? color.border : color.accent,
          cursor: locked ? "default" : "pointer",
          opacity: locked ? 0.45 : 1,
        }}
      />
    </div>
  );
};
