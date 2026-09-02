import type { CSSProperties } from "react";

export const color = {
  bg: "#0f172a",
  panel: "#1e293b",
  border: "#334155",
  text: "#f8fafc",
  muted: "#94a3b8",
  accent: "#3b82f6",
  ok: "#10b981",
  danger: "#f43f5e",
  warn: "#f59e0b",
};

export const container: CSSProperties = {
  fontFamily: "'Segoe UI', system-ui, sans-serif",
  background: color.bg,
  color: color.text,
  minHeight: "100vh",
  padding: "20px 16px 48px",
  boxSizing: "border-box",
  maxWidth: 1100,
  margin: "0 auto",
};

export const row: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  margin: "12px 0",
};

export const group: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  background: color.panel,
  border: `1px solid ${color.border}`,
  borderRadius: 8,
  padding: "6px 8px",
};

export const button: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  background: color.accent,
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "10px 16px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  letterSpacing: 1,
};

export const iconButton: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  color: color.muted,
  border: `1px solid ${color.border}`,
  borderRadius: 6,
  padding: 8,
  cursor: "pointer",
};

export const chip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  background: "transparent",
  color: color.muted,
  border: `1px solid ${color.border}`,
  borderRadius: 999,
  padding: "6px 12px",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 1,
  cursor: "pointer",
  textTransform: "uppercase",
};

export const input: CSSProperties = {
  background: color.bg,
  color: color.text,
  border: `1px solid ${color.border}`,
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 12,
  outline: "none",
};

export const select: CSSProperties = { ...input, cursor: "pointer" };

export const sectionGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: 12,
  marginTop: 16,
};

export const section: CSSProperties = {
  background: color.panel,
  border: `1px solid ${color.border}`,
  borderRadius: 10,
  padding: "12px 14px",
  textAlign: "left",
};

export const sectionTitle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 1.5,
  color: color.accent,
  marginBottom: 10,
  textTransform: "uppercase",
};

export const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(2, 6, 23, 0.75)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 50,
};

export const modal: CSSProperties = {
  background: color.panel,
  border: `1px solid ${color.border}`,
  borderRadius: 12,
  padding: 24,
  textAlign: "center",
  maxWidth: 380,
};

export const toast = (ok: boolean): CSSProperties => ({
  position: "fixed",
  top: 16,
  left: "50%",
  transform: "translateX(-50%)",
  background: ok ? color.ok : color.danger,
  color: "#fff",
  padding: "10px 18px",
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: 1,
  zIndex: 60,
});
