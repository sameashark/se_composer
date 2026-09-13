import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Download,
  FilePlus,
  Music,
  Play,
  Redo2,
  RotateCcw,
  Save,
  Shuffle,
  Square,
  Trash2,
  Undo2,
  Upload,
  Waves,
} from "lucide-react";
import { PianoRoll } from "./PianoRoll";
import type { PlaybackRange } from "./PianoRoll";
import { Params, OscillatorSelect } from "./components/Params";
import { downloadBlob, play, renderWav } from "./audio/player";
import type { Playback } from "./audio/player";
import { mergePresets, parsePresetFile } from "./presetFile";
import type { ParsedPresetFile } from "./presetFile";
import type { SeNote, SeParams } from "./core/engine.js";
import { makeSample, SAMPLE_KINDS } from "./randomize";
import { DEFAULT_PARAMS, useStore } from "./store";
import type { StoredPreset } from "./store";
import * as S from "./ui/styles";

interface Confirm {
  message: string;
  onConfirm: () => void;
}

export default function App() {
  const params = useStore((s) => s.params);
  const notes = useStore((s) => s.notes);
  const presets = useStore((s) => s.presets);
  const past = useStore((s) => s.past);
  const future = useStore((s) => s.future);

  const [presetName, setPresetName] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [toast, setToast] = useState<{ message: string; ok: boolean } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [playback, setPlayback] = useState<PlaybackRange | null>(null);
  const [dataMenuOpen, setDataMenuOpen] = useState(false);

  const dataMenuRef = useRef<HTMLDivElement>(null);
  const playbackRef = useRef<Playback | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const notify = useCallback((message: string, ok = true) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast({ message, ok });
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2200);
  }, []);

  const stopPlayback = useCallback(() => {
    playbackRef.current?.stop();
    playbackRef.current = null;
    if (stopTimerRef.current) window.clearTimeout(stopTimerRef.current);
    setIsPlaying(false);
    setPlayback(null);
  }, []);

  /** 常に store の最新値で鳴らす（スライダー操作直後でも取りこぼさない） */
  const playCurrent = useCallback(async () => {
    stopPlayback();
    const { params: p, notes: n } = useStore.getState();
    if (n.length === 0) return;
    try {
      const started = await play(p, n);
      playbackRef.current = started;
      setIsPlaying(true);
      setPlayback({ startAt: started.startAt, endAt: started.endTime });
      stopTimerRef.current = window.setTimeout(() => {
        playbackRef.current = null;
        setIsPlaying(false);
        setPlayback(null);
      }, started.durationMs + 120);
    } catch (e) {
      notify("再生できません", false);
    }
  }, [notify, stopPlayback]);

  const beginEdit = useCallback(() => {
    useStore.getState().pushHistory();
    setPresetName("");
  }, []);

  const endEdit = useCallback(() => {
    void playCurrent();
  }, [playCurrent]);

  const applySnapshot = useCallback(
    (nextParams: SeParams, nextNotes?: SeNote[], options?: { play?: boolean }) => {
      const store = useStore.getState();
      store.pushHistory();
      store.setParams(nextParams);
      if (nextNotes) store.setNotes(nextNotes);
      if (options?.play !== false) void playCurrent();
    },
    [playCurrent]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (meta && key === "z") {
        e.preventDefault();
        if (e.shiftKey) useStore.getState().redo();
        else useStore.getState().undo();
        void playCurrent();
      } else if (meta && key === "y") {
        e.preventDefault();
        useStore.getState().redo();
        void playCurrent();
      } else if (key === " " && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        void playCurrent();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [playCurrent]);

  useEffect(() => () => stopPlayback(), [stopPlayback]);

  // データメニューは外側クリックと Esc で閉じる
  useEffect(() => {
    if (!dataMenuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!dataMenuRef.current?.contains(e.target as Node)) setDataMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDataMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [dataMenuOpen]);

  /** パラメータだけを初期値に戻す。ノートには触らない */
  const resetParams = () => {
    applySnapshot({ ...DEFAULT_PARAMS });
    setPresetName("");
    notify("パラメータを初期値に戻しました");
  };

  const handleSample = (kind: (typeof SAMPLE_KINDS)[number] | "random") => {
    const { params: nextParams, note } = makeSample(kind);
    const store = useStore.getState();
    applySnapshot(nextParams, store.notes.length === 0 ? [note] : store.notes);
    setPresetName("");
  };

  const handleDownload = async () => {
    if (notes.length === 0) return;
    setIsExporting(true);
    try {
      const { blob, stats } = await renderWav(params, notes);
      downloadBlob(blob, `se_${presetName || Date.now()}.wav`);
      notify(`WAV ${stats.seconds.toFixed(2)}s / peak ${stats.peakDb.toFixed(1)}dB`);
    } catch {
      notify("書き出しに失敗しました", false);
    } finally {
      setIsExporting(false);
    }
  };

  const savePreset = () => {
    const name = presetName.trim();
    if (!name) {
      notify("名前を入力してください", false);
      return;
    }
    const store = useStore.getState();
    const overwrite = store.presets.some((p) => p.name === name);
    const next: StoredPreset = { version: 1, name, params: { ...params }, notes: notes.map((n) => ({ ...n })) };
    store.setPresets([next, ...store.presets.filter((p) => p.name !== name)]);
    notify(overwrite ? `上書き保存: ${name}` : `保存: ${name}`);
  };

  const loadPreset = (name: string) => {
    if (!name) {
      setPresetName("");
      return;
    }
    const preset = presets.find((p) => p.name === name);
    if (!preset) return;
    // 手元のリストを切り替えただけなので通知しない（音が鳴ることが結果になる）
    applySnapshot({ ...DEFAULT_PARAMS, ...preset.params }, preset.notes.map((n) => ({ ...n })));
    setPresetName(preset.name);
  };

  const deletePreset = () => {
    if (!presetName) return;
    setConfirm({
      message: `"${presetName}" を削除しますか？`,
      onConfirm: () => {
        const store = useStore.getState();
        store.setPresets(store.presets.filter((p) => p.name !== presetName));
        notify(`削除: ${presetName}`);
        setPresetName("");
        setConfirm(null);
      },
    });
  };

  const exportJson = () => {
    const data = { current: { params, notes }, history: presets };
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), `se_composer_${Date.now()}.json`);
    notify("JSON を書き出しました");
  };

  /** 今鳴っている音だけを単体プリセットとして書き出す。CLI がそのまま読める形式 */
  const exportCurrentPreset = () => {
    const name = presetName.trim() || "se";
    downloadBlob(
      new Blob([JSON.stringify({ name, params, notes }, null, 2)], { type: "application/json" }),
      `${name}.json`
    );
    notify(`${name}.json を書き出しました`);
  };

  /** pitch を持たないノートは読み飛ばされる。黙って消えると気付けないので件数を出す */
  const skippedNote = (count: number) => (count > 0 ? `（pitch が無いノート ${count} 件を除外）` : "");

  const readPresetFile = (event: React.ChangeEvent<HTMLInputElement>, handle: (parsed: ParsedPresetFile) => void) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed: ParsedPresetFile | null;
      try {
        parsed = parsePresetFile(JSON.parse(String(reader.result)));
      } catch {
        notify("JSON の解析に失敗しました", false);
        return;
      }
      if (!parsed) {
        notify("プリセットの形式ではありません", false);
        return;
      }
      handle(parsed);
    };
    reader.readAsText(file);
  };

  /** リストを置き換える */
  const importJson = (event: React.ChangeEvent<HTMLInputElement>) =>
    readPresetFile(event, ({ presets: loaded, current, skipped }) => {
      const store = useStore.getState();
      // ファイルを開いただけで音が鳴るのは押しつけがましいので、読み込みでは再生しない
      const silent = { play: false };
      // 単体プリセットでもリストは必ず置き換える。名前どおり「リスト読み込み」なので、
      // 中身が1件だからと更新を省くと一覧が変わらず読み込めていないように見える
      if (loaded.length > 0) store.setPresets(loaded);
      if (current) applySnapshot(current.params, current.notes, silent);
      setPresetName(loaded.length === 1 ? loaded[0].name : "");
      notify(
        loaded.length > 0
          ? `${loaded.length} 件のプリセットを読み込みました${skippedNote(skipped)}`
          : `現在の音を読み込みました${skippedNote(skipped)}`
      );
    });

  /** 今のリストの末尾に追加する */
  const appendJson = (event: React.ChangeEvent<HTMLInputElement>) =>
    readPresetFile(event, ({ presets: loaded, skipped }) => {
      if (loaded.length === 0) {
        notify("追加できるプリセットがありません", false);
        return;
      }
      const store = useStore.getState();
      const { presets: merged, added, renamed } = mergePresets(store.presets, loaded);
      store.setPresets(merged);
      notify(
        `${added} 件を追加しました（計 ${merged.length} 件）` +
          `${renamed > 0 ? `／名前が重複した ${renamed} 件はリネーム` : ""}${skippedNote(skipped)}`
      );
    });

  const clearNotes = () =>
    setConfirm({
      message: "すべてのノートを消去しますか？",
      onConfirm: () => {
        beginEdit();
        useStore.getState().clearNotes();
        notify("ノートを消去しました");
        setConfirm(null);
      },
    });

  return (
    <div style={S.container}>
      {toast && <div style={S.toast(toast.ok)}>{toast.message}</div>}

      {confirm && (
        <div style={S.overlay} onClick={() => setConfirm(null)}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            <AlertTriangle size={28} color={S.color.danger} />
            <div style={{ margin: "12px 0 20px", fontSize: 14 }}>{confirm.message}</div>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button style={{ ...S.button, background: S.color.border }} onClick={() => setConfirm(null)}>
                キャンセル
              </button>
              <button style={{ ...S.button, background: S.color.danger }} onClick={confirm.onConfirm}>
                実行
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          flexWrap: "wrap",
          gap: 8,
          margin: "0 0 10px",
        }}
      >
        <h1 style={{ fontSize: 18, letterSpacing: 3, margin: 0, marginRight: "auto" }}>SE-COMPOSER</h1>

        <button
          style={{ ...S.button, background: S.color.ok, padding: "8px 14px", fontSize: 12 }}
          onClick={() => void handleDownload()}
          disabled={isExporting || notes.length === 0}
        >
          <Download size={16} /> {isExporting ? "EXPORTING..." : "WAV"}
        </button>

        <select value={presetName} onChange={(e) => loadPreset(e.target.value)} style={{ ...S.select, minWidth: 170 }}>
          <option value="">-- 保存済みプリセット --</option>
          {presets.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>

        <input
          type="text"
          placeholder="プリセット名"
          value={presetName}
          onChange={(e) => setPresetName(e.target.value)}
          style={{ ...S.input, width: 150 }}
        />
        <button style={{ ...S.button, padding: "8px 12px", fontSize: 11 }} onClick={savePreset}>
          <Save size={13} /> SAVE
        </button>
        <button
          style={{ ...S.button, padding: "8px 12px", fontSize: 11, background: S.color.danger }}
          onClick={deletePreset}
        >
          DEL
        </button>

        <div ref={dataMenuRef} style={{ position: "relative" }}>
          <button
            style={{ ...S.labeledButton, padding: "7px 8px 7px 10px" }}
            onClick={() => setDataMenuOpen((open) => !open)}
            title="JSON の書き出し・読み込み"
          >
            データ <ChevronDown size={14} />
          </button>
          {dataMenuOpen && (
            <div style={S.menu}>
              <button
                className="menu-item"
                style={S.menuItem}
                onClick={() => {
                  exportCurrentPreset();
                  setDataMenuOpen(false);
                }}
                disabled={notes.length === 0}
                title="今の音だけを単体プリセットとして保存する。CLI がそのまま読める形式"
              >
                <Download size={14} /> この音の書き出し
              </button>
              <button
                className="menu-item"
                style={S.menuItem}
                onClick={() => {
                  exportJson();
                  setDataMenuOpen(false);
                }}
                title="保存済みプリセット全部を1ファイルに書き出す"
              >
                <Download size={14} /> リスト書き出し
              </button>
              <label className="menu-item" style={S.menuItem} title="読み込んだ内容でリストを置き換える">
                <Upload size={14} /> リスト読み込み
                <input
                  type="file"
                  accept=".json"
                  onChange={(e) => {
                    importJson(e);
                    setDataMenuOpen(false);
                  }}
                  style={{ display: "none" }}
                />
              </label>
              <label className="menu-item" style={S.menuItem} title="今のリストの末尾に追加する（マージ）">
                <FilePlus size={14} /> リストに追加
                <input
                  type="file"
                  accept=".json"
                  onChange={(e) => {
                    appendJson(e);
                    setDataMenuOpen(false);
                  }}
                  style={{ display: "none" }}
                />
              </label>
            </div>
          )}
        </div>
      </div>

      <PianoRoll playback={playback} />

      <div style={S.row}>
        <button style={S.button} onClick={() => (isPlaying ? stopPlayback() : void playCurrent())}>
          {isPlaying ? <Square size={16} /> : <Play size={16} />} {isPlaying ? "STOP" : "PLAY"}
        </button>
        <div style={{ display: "flex", gap: 4 }}>
          <button style={S.iconButton} onClick={() => { useStore.getState().undo(); void playCurrent(); }} disabled={past.length === 0} title="元に戻す (Ctrl+Z)">
            <Undo2 size={18} />
          </button>
          <button style={S.iconButton} onClick={() => { useStore.getState().redo(); void playCurrent(); }} disabled={future.length === 0} title="やり直す (Ctrl+Y)">
            <Redo2 size={18} />
          </button>
          <button style={S.iconButton} onClick={clearNotes} title="ノートを消去">
            <Trash2 size={18} />
          </button>
        </div>
        <div style={S.group}>
          <Waves size={14} color={S.color.muted} />
          <OscillatorSelect
            value={params.oscillatorType}
            onChange={(v) => {
              beginEdit();
              useStore.getState().setParam("oscillatorType", v);
              void playCurrent();
            }}
          />
        </div>
        <div style={S.group}>
          <Music size={14} color={S.color.muted} />
          <input
            type="number"
            value={params.bpm}
            min={40}
            max={300}
            onFocus={beginEdit}
            onChange={(e) => useStore.getState().setParam("bpm", Number(e.target.value) || 120)}
            onBlur={endEdit}
            style={{ ...S.input, width: 64 }}
          />
          <span style={{ fontSize: 10, color: S.color.muted }}>BPM</span>
        </div>
      </div>

      <div style={S.row}>
        {SAMPLE_KINDS.map((kind) => (
          <button key={kind} style={S.chip} onClick={() => handleSample(kind)}>
            {kind}
          </button>
        ))}
        <button style={{ ...S.chip, borderColor: S.color.accent, color: S.color.accent }} onClick={() => handleSample("random")}>
          <Shuffle size={12} /> random
        </button>
        <button style={S.chip} onClick={resetParams} title="パラメータだけを初期値に戻す（ノートは残る）">
          <RotateCcw size={12} /> reset
        </button>
      </div>

      <Params onStart={beginEdit} onEnd={endEdit} />
    </div>
  );
}
