import { useCallback, useSyncExternalStore } from "react";

const KEY = "se_composer_ui";

/**
 * 画面の表示設定。パラメータのロックと違って「一時的な作業モード」ではなく好みなので、
 * リロードしても保つ。読めなければ既定値で動けばよい。
 *
 * 設定するのはヘッダーの歯車、効くのは別のコンポーネント、という配置になるため、
 * 値は1箇所に置いて購読させる（`useState` を各所で持つと同期しない）。
 */
export interface UiSettings {
  /** サンプルプリセットのボタン（laser〜random）を出しているか */
  samples: boolean;
  /** 半音（黒鍵）の行を出しているか */
  sharps: boolean;
}

const DEFAULTS: UiSettings = { samples: false, sharps: false };

function read(): UiSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!raw || typeof raw !== "object") return { ...DEFAULTS };
    return {
      samples: typeof raw.samples === "boolean" ? raw.samples : DEFAULTS.samples,
      sharps: typeof raw.sharps === "boolean" ? raw.sharps : DEFAULTS.sharps,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let current = read();
const listeners = new Set<() => void>();

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

export function setUiSetting<K extends keyof UiSettings>(key: K, value: UiSettings[K]): void {
  if (current[key] === value) return;
  current = { ...current, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // 書けなくてもそのセッション中は動く
  }
  for (const notify of listeners) notify();
}

/** 設定を1つ読み書きする。`useState` と同じ形で使える */
export function useUiSetting<K extends keyof UiSettings>(
  key: K
): [UiSettings[K], (value: UiSettings[K]) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => current[key],
    () => DEFAULTS[key]
  );
  const set = useCallback((next: UiSettings[K]) => setUiSetting(key, next), [key]);
  return [value, set];
}
