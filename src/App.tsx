import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  CircleHelp,
  Download,
  FileOutput,
  FolderInput,
  FolderOutput,
  FolderPlus,
  Music,
  Play,
  Redo2,
  Repeat,
  RotateCcw,
  Save,
  Settings,
  Shuffle,
  Sparkles,
  Square,
  Timer,
  Trash2,
  Undo2,
  Waves,
} from "lucide-react";
import { PianoRoll } from "./PianoRoll";
import type { PlaybackRange } from "./PianoRoll";
import { Waveform } from "./Waveform";
import { LockToggle } from "./components/LockToggle";
import { ShortcutsDialog } from "./components/ShortcutsDialog";
import { Params, OscillatorSelect } from "./components/Params";
import { downloadBlob, play, playFixed, renderWav } from "./audio/player";
import type { Playback } from "./audio/player";
import { mergePresets, parsePresetFile } from "./presetFile";
import type { ParsedPresetFile } from "./presetFile";
import { timeToStep } from "./core/engine.js";
import type { SeNote, SeParams } from "./core/engine.js";
import { makeSample, SAMPLE_KINDS } from "./randomize";
import { DEFAULT_PARAMS, presetToJson, useStore } from "./store";
import type { StoredPreset } from "./store";
import { useUiSetting } from "./ui/settings";
import * as S from "./ui/styles";

/**
 * 「保存済みプリセットと同じ中身か」を比べるための文字列。
 * id と time の表記ゆれは読み込み経路で変わるので、比較から外す。
 * **保存される項目はすべて入れること。** 漏れると、変えたのに変更ありにならない
 */
const presetSignature = (params: SeParams, notes: SeNote[], exportSeconds: number | null) =>
  JSON.stringify([
    (Object.keys(DEFAULT_PARAMS) as (keyof SeParams)[]).map((k) => params[k]),
    notes.map((n) => `${timeToStep(n.time)}|${n.pitch}|${n.width}|${n.velocity}`).sort(),
    exportSeconds,
  ]);

/** 尺の指定があるときだけ JSON に載せる。無指定のプリセットに空欄を増やさない */
const exportField = (seconds: number | null) => (seconds === null ? null : { export: { seconds } });

interface Confirm {
  message: string;
  onConfirm: () => void;
}

export default function App() {
  const params = useStore((s) => s.params);
  const notes = useStore((s) => s.notes);
  const exportSeconds = useStore((s) => s.exportSeconds);
  // ♯のノートがある譜面で行を隠すと編集できなくなるため、その場合は常に表示される
  const hasSharpNote = notes.some((n) => n.pitch.includes("#"));
  const presets = useStore((s) => s.presets);
  const past = useStore((s) => s.past);
  const future = useStore((s) => s.future);
  const oscillatorLocked = useStore((s) => s.lockedParams.includes("oscillatorType"));
  const bpmLocked = useStore((s) => s.lockedParams.includes("bpm"));

  const presetName = useStore((s) => s.presetName);
  const setPresetName = useStore((s) => s.setPresetName);
  // 同名の保存済みプリセットと中身が違う＝SAVE すると上書きになる状態。
  // 編集フラグにしないのは、数値欄の onFocus でも beginEdit が走るため
  const basePreset = presets.find((p) => p.name === presetName.trim());
  const dirty =
    !!basePreset &&
    presetSignature(params, notes, exportSeconds) !==
      presetSignature(
        { ...DEFAULT_PARAMS, ...basePreset.params },
        basePreset.notes,
        basePreset.exportSeconds
      );
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [toast, setToast] = useState<{ message: string; ok: boolean } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [playback, setPlayback] = useState<PlaybackRange | null>(null);
  const [dataMenuOpen, setDataMenuOpen] = useState(false);
  // 一度開いたら閉じるまで出しっぱなし。毎回使うものではないので既定は閉じている
  const [samplesOpen, setSamplesOpen] = useUiSetting("samples");
  const [loopEnabled, setLoopEnabled] = useUiSetting("loop");
  const [showSharps, setShowSharps] = useUiSetting("sharps");
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const dataMenuRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const playbackRef = useRef<Playback | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  // チェックを外しても秒数を覚えておく。入れ直すたびに 1.0 に戻るのは煩わしい
  const lastSecondsRef = useRef(1);

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
    const { params: p, notes: n, exportSeconds: sec } = useStore.getState();
    if (n.length === 0) return;
    try {
      // 尺を指定しているなら、単発でも書き出しと同じ（切ってフェードした）音を鳴らす。
      // LOOP はそれを繰り返すかどうかの違いだけ
      const started = sec !== null ? await playFixed(p, n, sec, loopEnabled) : await play(p, n);
      playbackRef.current = started;
      setIsPlaying(true);
      setPlayback({ startAt: started.startAt, endAt: started.endTime, loopSeconds: started.loopSeconds });
      // ループは止めるまで鳴り続けるので、自動停止のタイマーは張らない
      if (Number.isFinite(started.durationMs)) {
        stopTimerRef.current = window.setTimeout(() => {
          playbackRef.current = null;
          setIsPlaying(false);
          setPlayback(null);
        }, started.durationMs + 120);
      }
    } catch (e) {
      notify("再生できません", false);
    }
  }, [loopEnabled, notify, stopPlayback]);

  const beginEdit = useCallback(() => {
    useStore.getState().pushHistory();
  }, []);

  const endEdit = useCallback(() => {
    void playCurrent();
  }, [playCurrent]);

  /**
   * 尺を変える。**必ず再生を止める。** 鳴っている音は変更前の尺でレンダリングした
   * バッファなので、止めずに変えると音とカーソルだけが古い周期のまま回り、
   * 画面の尺ラインと合わなくなる
   */
  const changeExportSeconds = useCallback(
    (seconds: number | null) => {
      stopPlayback();
      if (seconds !== null) lastSecondsRef.current = seconds;
      useStore.getState().setExportSeconds(seconds);
    },
    [stopPlayback]
  );

  const applySnapshot = useCallback(
    (
      nextParams: SeParams,
      nextNotes?: SeNote[],
      options?: { play?: boolean; exportSeconds?: number | null }
    ) => {
      const store = useStore.getState();
      store.pushHistory();
      store.setParams(nextParams);
      if (nextNotes) store.setNotes(nextNotes);
      // pushHistory より後に置く。先に設定すると undo で尺だけ戻らない
      if (options?.exportSeconds !== undefined) {
        if (options.exportSeconds !== null) lastSecondsRef.current = options.exportSeconds;
        store.setExportSeconds(options.exportSeconds);
      }
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

  // ヘッダーのドロップダウンは外側クリックと Esc で閉じる
  useEffect(() => {
    if (!dataMenuOpen && !optionsOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!dataMenuRef.current?.contains(e.target as Node)) setDataMenuOpen(false);
      if (!optionsRef.current?.contains(e.target as Node)) setOptionsOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setDataMenuOpen(false);
      setOptionsOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [dataMenuOpen, optionsOpen]);

  // ダイアログが開いている間の Esc は、そちらを閉じるほうに使う
  useEffect(() => {
    if (!helpOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHelpOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [helpOpen]);

  /** パラメータだけを初期値に戻す。ノートには触らない */
  const resetParams = () => {
    applySnapshot({ ...DEFAULT_PARAMS });
    notify("パラメータを初期値に戻しました");
  };

  const handleSample = (kind: (typeof SAMPLE_KINDS)[number] | "random") => {
    const { params: nextParams, note } = makeSample(kind);
    const store = useStore.getState();
    applySnapshot(nextParams, store.notes.length === 0 ? [note] : store.notes);
  };

  const handleDownload = async () => {
    if (notes.length === 0) return;
    setIsExporting(true);
    try {
      const { blob, stats } = await renderWav(params, notes, { seconds: exportSeconds });
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
    // 新規は末尾（JSON の「リストに追加」と揃える）、上書きは位置を動かさない
    const at = store.presets.findIndex((p) => p.name === name);
    const write = () => {
      const next: StoredPreset = {
        version: 1,
        name,
        params: { ...params },
        notes: notes.map((n) => ({ ...n })),
        exportSeconds,
      };
      store.setPresets(
        at < 0 ? [...store.presets, next] : store.presets.map((p, i) => (i === at ? next : p))
      );
      setPresetName(name);
    };
    if (at < 0) {
      write();
      notify(`保存: ${name}`);
      return;
    }
    setConfirm({
      message: `"${name}" を上書き保存しますか？`,
      onConfirm: () => {
        write();
        notify(`上書き保存: ${name}`);
        setConfirm(null);
      },
    });
  };

  const loadPreset = (name: string) => {
    if (!name) {
      setPresetName("");
      return;
    }
    const preset = presets.find((p) => p.name === name);
    if (!preset) return;
    // 保存済みプリセットは「その音をそのまま呼び出す」操作なので、ロックは全部解除する。
    // 残すと呼び出した音と画面の値が食い違う
    useStore.getState().clearLocks();
    // 手元のリストを切り替えただけなので通知しない（音が鳴ることが結果になる）
    applySnapshot({ ...DEFAULT_PARAMS, ...preset.params }, preset.notes.map((n) => ({ ...n })), {
      exportSeconds: preset.exportSeconds,
    });
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
    const data = {
      current: { params, notes, ...exportField(exportSeconds) },
      history: presets.map(presetToJson),
    };
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), `se_composer_${Date.now()}.json`);
    notify("JSON を書き出しました");
  };

  /** 今鳴っている音だけを単体プリセットとして書き出す。CLI がそのまま読める形式 */
  const exportCurrentPreset = () => {
    const name = presetName.trim() || "se";
    downloadBlob(
      new Blob([JSON.stringify({ name, params, notes, ...exportField(exportSeconds) }, null, 2)], {
        type: "application/json",
      }),
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
      if (current) {
        store.clearLocks(); // プリセット選択と同じ扱い
        applySnapshot(current.params, current.notes, { ...silent, exportSeconds: current.exportSeconds });
      }
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

      {helpOpen && <ShortcutsDialog onClose={() => setHelpOpen(false)} />}

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

        <div style={S.nameField}>
          <input
            type="text"
            placeholder="プリセット名"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            title={dirty ? "保存済みの内容と違います。SAVE で上書きになります" : undefined}
            style={dirty ? S.nameInputDirty : S.nameInput}
          />
          {dirty && basePreset && (
            <button
              style={S.revertButton}
              onClick={() => loadPreset(basePreset.name)}
              title={`"${basePreset.name}" の保存済みの内容に戻す`}
            >
              <RotateCcw size={13} />
            </button>
          )}
        </div>
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
                title="今の音だけを単体プリセットとして保存する"
              >
                <FileOutput size={14} style={S.flipX} /> この音の書き出し
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
                <FolderOutput size={14} style={S.flipX} /> リスト書き出し
              </button>
              <label className="menu-item" style={S.menuItem} title="読み込んだ内容でリストを置き換える">
                <FolderInput size={14} style={S.flipX} /> リスト読み込み
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
                <FolderPlus size={14} /> リストに追加
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

        <div ref={optionsRef} style={{ position: "relative" }}>
          <button
            style={{ ...S.labeledButton, padding: "6px 8px" }}
            onClick={() => setOptionsOpen((open) => !open)}
            title="表示の設定と操作方法"
          >
            <Settings size={15} />
          </button>
          {optionsOpen && (
            <div style={S.menu}>
              <label
                className="menu-item"
                style={{ ...S.menuItem, cursor: hasSharpNote ? "default" : "pointer" }}
                title={hasSharpNote ? "♯のノートがあるため常に表示します" : "半音（黒鍵）の行を表示する"}
              >
                <input
                  type="checkbox"
                  checked={showSharps || hasSharpNote}
                  disabled={hasSharpNote}
                  onChange={(e) => setShowSharps(e.target.checked)}
                />
                ♯（黒鍵）の行を表示
              </label>
              <button
                className="menu-item"
                style={S.menuItem}
                onClick={() => {
                  setHelpOpen(true);
                  setOptionsOpen(false);
                }}
              >
                <CircleHelp size={14} /> 操作とショートカット
              </button>
            </div>
          )}
        </div>
      </div>

      <PianoRoll playback={playback} dialogOpen={helpOpen}>
        <Waveform playback={playback} />
      </PianoRoll>

      <div style={S.row}>
        <button style={S.button} onClick={() => (isPlaying ? stopPlayback() : void playCurrent())}>
          {isPlaying ? <Square size={16} /> : <Play size={16} />} {isPlaying ? "STOP" : "PLAY"}
        </button>
        <button
          style={{
            ...S.iconButton,
            padding: "6px 8px",
            gap: 4,
            fontSize: 11,
            ...(loopEnabled && exportSeconds !== null ? { color: S.color.accent } : null),
          }}
          onClick={() => {
            stopPlayback();
            setLoopEnabled(!loopEnabled);
          }}
          disabled={exportSeconds === null}
          title={
            exportSeconds === null
              ? "尺を揃えているときだけ使える（書き出しと同じ長さで繰り返す）"
              : "書き出しと同じ音をループ再生して、繋ぎ目を確かめる"
          }
        >
          <Repeat size={15} /> LOOP
        </button>
        <div style={{ display: "flex", gap: 8 }}>
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
            disabled={oscillatorLocked}
            onChange={(v) => {
              beginEdit();
              useStore.getState().setParam("oscillatorType", v);
              void playCurrent();
            }}
          />
          <LockToggle paramKey="oscillatorType" />
        </div>
        <div style={S.group}>
          <Music size={14} color={S.color.muted} />
          <input
            type="number"
            value={params.bpm}
            min={40}
            max={300}
            disabled={bpmLocked}
            onFocus={beginEdit}
            onChange={(e) => useStore.getState().setParam("bpm", Number(e.target.value) || 120)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                endEdit();
              }
            }}
            style={{ ...S.input, width: 64, opacity: bpmLocked ? 0.45 : 1 }}
          />
          <span style={{ fontSize: 10, color: S.color.muted }}>BPM</span>
          <LockToggle paramKey="bpm" />
        </div>

        {/* 尺の指定。ゲームで繰り返し鳴らす素材は、音＋余韻で厳密に N 秒である必要がある */}
        <div style={S.group}>
          <Timer size={14} color={S.color.muted} />
          <label
            style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: S.color.muted, cursor: "pointer" }}
            title="書き出しをこの長さちょうどに揃える。短ければ無音で埋め、はみ出た分は切る"
          >
            <input
              type="checkbox"
              checked={exportSeconds !== null}
              onChange={(e) => {
                beginEdit();
                changeExportSeconds(e.target.checked ? lastSecondsRef.current : null);
              }}
            />
            尺を揃える
          </label>
          <input
            type="number"
            value={exportSeconds ?? lastSecondsRef.current}
            min={0.1}
            max={30}
            step={0.1}
            disabled={exportSeconds === null}
            onFocus={beginEdit}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isFinite(v) || v <= 0) return;
              changeExportSeconds(v);
            }}
            // 他の数値欄と同じく、確定（鳴らし直し）は Enter に任せる
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                endEdit();
              }
            }}
            style={{ ...S.input, width: 60, opacity: exportSeconds === null ? 0.45 : 1 }}
          />
          <span style={{ fontSize: 10, color: S.color.muted }}>秒</span>
        </div>
      </div>

      <div style={S.row}>
        <button
          style={{ ...S.chip, ...(samplesOpen ? { borderColor: S.color.accent, color: S.color.accent } : null) }}
          onClick={() => setSamplesOpen(!samplesOpen)}
          title="カテゴリ別のサンプルを作るボタンを出す"
        >
          <Sparkles size={12} /> サンプルプリセット
          <ChevronDown size={12} style={{ transform: samplesOpen ? "rotate(180deg)" : undefined }} />
        </button>
        <button style={S.chip} onClick={resetParams} title="パラメータだけを初期値に戻す（ノートは残る）">
          <RotateCcw size={12} /> reset
        </button>
      </div>

      {samplesOpen && (
        <div style={{ ...S.row, marginTop: -4 }}>
          {SAMPLE_KINDS.map((kind) => (
            <button key={kind} style={S.chip} onClick={() => handleSample(kind)}>
              {kind}
            </button>
          ))}
          <button
            style={{ ...S.chip, borderColor: S.color.accent, color: S.color.accent }}
            onClick={() => handleSample("random")}
          >
            <Shuffle size={12} /> random
          </button>
        </div>
      )}

      <Params onStart={beginEdit} onEnd={endEdit} />
    </div>
  );
}
