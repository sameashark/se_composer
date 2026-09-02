import React from "react";
import { color } from "../ui/styles";

interface SliderProps {
  label: string;
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
  value,
  min,
  max,
  step = 1,
  digits = 2,
  onStart,
  onChange,
  onEnd,
}) => (
  <div style={{ marginBottom: 10 }}>
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: color.muted }}>
      <span style={{ letterSpacing: 1 }}>{label}</span>
      <input
        type="number"
        value={Number(value.toFixed(digits))}
        min={min}
        max={max}
        step={step}
        onFocus={onStart}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
        }}
        onBlur={onEnd}
        style={{
          width: 68,
          background: color.bg,
          color: color.text,
          border: `1px solid ${color.border}`,
          borderRadius: 4,
          fontSize: 10,
          padding: "2px 4px",
          textAlign: "right",
        }}
      />
    </div>
    <input
      type="range"
      value={value}
      min={min}
      max={max}
      step={step}
      onPointerDown={onStart}
      onChange={(e) => onChange(Number(e.target.value))}
      onPointerUp={onEnd}
      onKeyUp={onEnd}
      style={{ width: "100%", accentColor: color.accent, cursor: "pointer" }}
    />
  </div>
);
