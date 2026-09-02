import React from "react";
import { Activity, Clock, Settings, Zap } from "lucide-react";
import { Slider } from "./Slider";
import { useStore } from "../store";
import type { LfoTarget, OscillatorKind, SeParams } from "../core/engine.js";
import { OSCILLATOR_TYPES } from "../store";
import { color, section, sectionGrid, sectionTitle, select } from "../ui/styles";

interface ParamsProps {
  onStart: () => void;
  onEnd: () => void;
}

export const Params: React.FC<ParamsProps> = ({ onStart, onEnd }) => {
  const params = useStore((s) => s.params);
  const setParam = useStore((s) => s.setParam);

  const num = (key: keyof SeParams, label: string, min: number, max: number, step: number, digits = 2) => (
    <Slider
      key={key}
      label={label}
      value={params[key] as number}
      min={min}
      max={max}
      step={step}
      digits={digits}
      onStart={onStart}
      onChange={(v) => setParam(key, v as SeParams[typeof key])}
      onEnd={onEnd}
    />
  );

  return (
    <div style={sectionGrid}>
      <div style={section}>
        <div style={sectionTitle}>
          <Clock size={14} /> Envelope
        </div>
        {num("attack", "ATTACK (s)", 0, 2, 0.005, 3)}
        {num("decay", "DECAY (s)", 0.01, 2, 0.01)}
        {num("sustain", "SUSTAIN", 0, 1, 0.01)}
        {num("release", "RELEASE (s)", 0.01, 3, 0.01)}
      </div>

      <div style={section}>
        <div style={sectionTitle}>
          <Activity size={14} /> Pitch &amp; Repeat
        </div>
        {num("pitchAmount", "PITCH SWEEP (semi)", -48, 48, 1, 0)}
        {num("pitchTime", "SWEEP TIME (s)", 0.01, 1.5, 0.01)}
        {num("repeatSpeed", "REPEAT SPEED (Hz)", 0, 100, 0.5, 1)}
        {num("arpAmount", "ARP STEP (semi)", -12, 12, 1, 0)}
      </div>

      <div style={section}>
        <div style={sectionTitle}>
          <Zap size={14} /> Modulation
        </div>
        {num("lfoRate", "LFO RATE (Hz)", 0.1, 20, 0.1, 1)}
        {num("lfoDepth", "LFO DEPTH", 0, 100, 1, 0)}
        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0 12px" }}>
          <span style={{ fontSize: 10, color: color.muted, letterSpacing: 1 }}>LFO TARGET</span>
          <select
            value={params.lfoTarget}
            onChange={(e) => {
              onStart();
              setParam("lfoTarget", e.target.value as LfoTarget);
              onEnd();
            }}
            style={{ ...select, fontSize: 11, padding: "4px 6px" }}
          >
            <option value="pitch">pitch</option>
            <option value="filter">filter</option>
          </select>
          {params.lfoTarget === "pitch" && params.oscillatorType === "noise" && (
            <span style={{ fontSize: 10, color: color.warn }}>noise では無効</span>
          )}
        </div>
        {num("detune", "DETUNE (cents)", 0, 50, 1, 0)}
      </div>

      <div style={section}>
        <div style={sectionTitle}>
          <Settings size={14} /> Filter &amp; Output
        </div>
        {num("filterCutoff", "CUTOFF (Hz)", 100, 10000, 10, 0)}
        {num("filterEnvAmount", "FILTER ENV (cents)", 0, 10000, 10, 0)}
        {num("delayFeedback", "DELAY", 0, 0.9, 0.01)}
        {num("masterVolume", "MASTER (dB)", -60, 0, 1, 0)}
      </div>
    </div>
  );
};

interface OscillatorSelectProps {
  value: OscillatorKind;
  onChange: (value: OscillatorKind) => void;
}

export const OscillatorSelect: React.FC<OscillatorSelectProps> = ({ value, onChange }) => (
  <select value={value} onChange={(e) => onChange(e.target.value as OscillatorKind)} style={select}>
    {OSCILLATOR_TYPES.map((o) => (
      <option key={o} value={o}>
        {o}
      </option>
    ))}
  </select>
);
