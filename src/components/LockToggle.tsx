import React from "react";
import { Lock, LockOpen } from "lucide-react";
import { useStore } from "../store";
import type { SeParams } from "../core/engine.js";
import { lockToggle } from "../ui/styles";

interface LockToggleProps {
  paramKey: keyof SeParams;
  size?: number;
}

export const LockToggle: React.FC<LockToggleProps> = ({ paramKey, size = 12 }) => {
  const locked = useStore((s) => s.lockedParams.includes(paramKey));
  const toggleLock = useStore((s) => s.toggleLock);

  return (
    <button
      type="button"
      style={lockToggle(locked)}
      onClick={() => toggleLock(paramKey)}
      title={locked ? "ロック解除（reset とサンプルで変わるようになる）" : "ロック（reset とサンプルで変わらなくなる）"}
      aria-pressed={locked}
    >
      {locked ? <Lock size={size} /> : <LockOpen size={size} />}
    </button>
  );
};
