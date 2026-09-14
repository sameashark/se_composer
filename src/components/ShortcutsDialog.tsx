import React from "react";
import { X } from "lucide-react";
import { color, modal, overlay } from "../ui/styles";

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

interface ShortcutsDialogProps {
  onClose: () => void;
}

export const ShortcutsDialog: React.FC<ShortcutsDialogProps> = ({ onClose }) => (
  <div style={overlay} onClick={onClose}>
    <div
      style={{ ...modal, textAlign: "left", maxWidth: 560, width: "90%", maxHeight: "80vh", overflowY: "auto" }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1 }}>操作とショートカット</span>
        <button
          onClick={onClose}
          title="閉じる (Esc)"
          style={{ display: "inline-flex", background: "transparent", color: color.muted, border: "none", padding: 0, cursor: "pointer" }}
        >
          <X size={16} />
        </button>
      </div>
      {SHORTCUTS.map((group) => (
        <div key={group.title} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: color.accent, marginBottom: 4 }}>
            {group.title}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <tbody>
              {group.rows.map(([keys, description]) => (
                <tr key={keys}>
                  <td style={{ width: 1, whiteSpace: "nowrap", verticalAlign: "top", padding: "3px 14px 3px 0" }}>
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
);
