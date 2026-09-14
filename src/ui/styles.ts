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
  // レスポンシブにしない。これを下回るとパラメータが4列に並ばず、
  // ピアノロールと波形がそれぞれ内部で横スクロールして時間軸がずれる。
  // 狭い画面では body ごと横に流し、両者が必ず同じだけ動くようにする
  //   パラメータ4列  240x4 + gap 12x3 = 996px
  //   ピアノロール   KEY_W 46 + CANVAS_W 896 + border 2 = 944px
  minWidth: 1030,
  margin: "0 auto",
};

export const row: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "center",
  gap: 18,
  margin: "14px 0",
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
  // 枠に対してアイコンが小さいと矢印や+の向きが読めないので、余白は詰める
  padding: 4,
  cursor: "pointer",
};

/** アイコン＋短いラベルのボタン。ファイル操作のように機能名が要るもの向け */
export const labeledButton: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  background: "transparent",
  color: color.muted,
  border: `1px solid ${color.border}`,
  borderRadius: 6,
  padding: "5px 10px 5px 7px",
  fontSize: 11,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export const menu: CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  right: 0,
  minWidth: 180,
  background: color.panel,
  border: `1px solid ${color.border}`,
  borderRadius: 8,
  padding: 4,
  boxShadow: "0 8px 24px rgba(2, 6, 23, 0.6)",
  zIndex: 20,
};

export const menuItem: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  background: "transparent",
  color: color.text,
  border: "none",
  borderRadius: 6,
  padding: "8px 10px",
  // button と label でフォントがばらつかないよう明示する
  fontFamily: "inherit",
  fontSize: 12,
  lineHeight: 1.4,
  textAlign: "left",
  cursor: "pointer",
  whiteSpace: "nowrap",
  boxSizing: "border-box",
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

/**
 * アイコンの左右反転。lucide の file-input / file-output は紙が右・矢印が左に描かれていて、
 * そのままだと「書き出しなのに矢印が左を向く」ことになる。反転すると紙が左に来て、
 * 手元（左）から外（右）へ出る＝書き出し、外から手元へ入る＝読み込み、と向きが揃う
 */
export const flipX: CSSProperties = { transform: "scaleX(-1)" };

/** パラメータの錠アイコン。数値欄や select の右に並べる */
export const lockToggle = (locked: boolean): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  // 解除時は主張させたくないが、border 色では暗すぎて見えない
  color: locked ? color.accent : "#64748b",
  border: "none",
  padding: 0,
  lineHeight: 0,
  cursor: "pointer",
  flexShrink: 0,
});

export const input: CSSProperties = {
  background: color.bg,
  color: color.text,
  border: `1px solid ${color.border}`,
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 12,
  outline: "none",
};

/**
 * プリセット名の欄。「戻す」ボタンを内側に重ねるため、幅はここで固定する。
 * ボタンを隣に並べると、出入りのたびに右のボタン群が横に動く
 */
export const nameField: CSSProperties = { position: "relative", width: 172, display: "inline-flex" };

export const nameInput: CSSProperties = {
  ...input,
  width: "100%",
  boxSizing: "border-box",
  // ボタンの有無で文字の折り返し位置が変わらないよう、右の余白は常に空けておく
  paddingRight: 28,
};

/** 保存済みプリセットと中身が食い違っている名前欄。SAVE すると上書きになる合図 */
export const nameInputDirty: CSSProperties = {
  ...nameInput,
  background: "rgba(245, 158, 11, 0.18)",
  borderColor: color.warn,
};

export const revertButton: CSSProperties = {
  position: "absolute",
  right: 5,
  top: "50%",
  transform: "translateY(-50%)",
  display: "inline-flex",
  background: "transparent",
  border: "none",
  color: color.warn,
  cursor: "pointer",
  padding: 2,
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
