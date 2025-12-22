// @ts-nocheck
import React, { useState, useEffect, useRef, useCallback } from "react";
import * as Tone from "tone";
import {
  Play,
  Square,
  Trash2,
  Clock,
  Waves,
  Shuffle,
  Download,
  Activity,
  Settings,
  Music,
  Save,
  FileUp,
  FileDown,
  Undo2,
  Redo2,
  AlertTriangle,
} from "lucide-react";
import { useStore, OscillatorType, Preset, DEFAULT_STATE, Note } from "./store"; // Noteを追加
import { PianoRoll } from "./PianoRoll";

export default function App() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [presetName, setPresetName] = useState("");

  const [toast, setToast] = useState<{
    msg: string;
    type: "success" | "error";
  } | null>(null);
  const [confirmData, setConfirmData] = useState<{
    msg: string;
    onConfirm: () => void;
  } | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback(
    (msg: string, type: "success" | "error" = "success") => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      setToast({ msg, type });
      toastTimerRef.current = window.setTimeout(() => setToast(null), 2000);
    },
    []
  );

  const state = useStore();
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const activeEnginesRef = useRef<{ stop: () => void }[]>([]);

  const stopAndDispose = useCallback(() => {
    activeEnginesRef.current.forEach((engine) => engine.stop());
    activeEnginesRef.current = [];
    setIsPlaying(false);
  }, []);

  const handleUserChange = useCallback(() => {
    if (presetName !== "") setPresetName("");
  }, [presetName]);

  const createSynthChain = (
    s: any,
    destination: any,
    polyCount: number = 1
  ) => {
    const polyCompensation = Math.log10(Math.max(1, polyCount)) * 15;
    const finalVolume = s.masterVolume - polyCompensation;
    const limiter = new Tone.Limiter(-1).connect(destination);
    const filter = new Tone.Filter(s.filterCutoff, "lowpass").connect(limiter);
    filter.Q.value = 2;
    const delay = new Tone.FeedbackDelay("8n", s.delayFeedback).connect(filter);
    const commonEnvelope = {
      attack: s.attack,
      decay: s.decay,
      sustain: s.sustain,
      release: s.release,
    };
    let source: any;
    if (s.oscillatorType === "noise") {
      source = new Tone.NoiseSynth({
        noise: { type: "brown" },
        envelope: commonEnvelope,
      }).connect(delay);
    } else {
      source = new Tone.Synth({
        oscillator: { type: s.oscillatorType as any },
        envelope: commonEnvelope,
      }).connect(delay);
    }
    source.volume.value = finalVolume;
    return { source, filter, delay, limiter };
  };

  const playOnce = useCallback(async () => {
    await Tone.start();
    stopAndDispose();
    const s = stateRef.current;
    if (s.notes.length === 0) return;
    const now = Tone.now();
    const beatTime = 60 / s.bpm / 4;
    const engines: { stop: () => void }[] = [];
    let lastEndTime = 0;
    const polyCount = s.notes.length;

    s.notes.forEach((note: Note) => {
      const parts = note.time.split(":").map(Number);
      const colIndex = parts[1] * 4 + parts[2];
      const startTime = now + colIndex * beatTime + 0.05;
      const totalDuration = note.width * beatTime;
      const endTime = colIndex * beatTime + totalDuration + s.release;
      if (endTime > lastEndTime) lastEndTime = endTime;

      const { source, filter, delay, limiter } = createSynthChain(
        s,
        Tone.getDestination(),
        polyCount
      );
      if (s.filterEnvAmount !== 0) {
        filter.detune.setValueAtTime(0, startTime);
        filter.detune.linearRampToValueAtTime(
          s.filterEnvAmount,
          startTime + s.attack
        );
        filter.detune.linearRampToValueAtTime(
          0,
          startTime + s.attack + s.decay
        );
      }
      if (s.repeatSpeed > 0) {
        const interval = 1 / s.repeatSpeed;
        let t = 0;
        let count = 0;
        while (t < totalDuration) {
          const triggerTime = startTime + t;
          const singleNoteDur = Math.min(interval * 0.9, totalDuration - t);
          if (s.oscillatorType === "noise") {
            source.triggerAttackRelease(singleNoteDur, triggerTime);
          } else {
            const baseFreq = Tone.Frequency(note.pitch).toFrequency();
            const arpFreq = baseFreq * Math.pow(2, (s.arpAmount * count) / 12);
            source.detune.setValueAtTime(0, triggerTime);
            source.triggerAttackRelease(arpFreq, singleNoteDur, triggerTime);
            if (s.pitchAmount !== 0)
              source.detune.linearRampToValueAtTime(
                s.pitchAmount * 100,
                triggerTime + s.pitchTime
              );
          }
          t += interval;
          count++;
        }
      } else {
        if (s.oscillatorType === "noise")
          source.triggerAttackRelease(totalDuration, startTime);
        else {
          source.detune.setValueAtTime(0, startTime);
          source.triggerAttackRelease(note.pitch, totalDuration, startTime);
          if (s.pitchAmount !== 0)
            source.detune.linearRampToValueAtTime(
              s.pitchAmount * 100,
              startTime + s.pitchTime
            );
        }
      }
      const stopSelf = () => {
        source.volume.rampTo(-Infinity, 0.1);
        setTimeout(() => {
          [source, delay, filter, limiter].forEach((n) => {
            try {
              n.dispose();
            } catch (e) {}
          });
        }, 200);
      };
      const timeoutId = setTimeout(
        stopSelf,
        (endTime + s.delayFeedback * 10 + 1) * 1000
      );
      engines.push({
        stop: () => {
          clearTimeout(timeoutId);
          stopSelf();
        },
      });
    });
    activeEnginesRef.current = engines;
    setIsPlaying(true);
    setTimeout(
      () => setIsPlaying(false),
      (lastEndTime + s.delayFeedback * 10 + 1) * 1000
    );
  }, [stopAndDispose]);

  const onParamEdit = (v: number, setter: (v: number) => void) => {
    state.pushHistory();
    handleUserChange();
    setter(v);
    setTimeout(playOnce, 10);
  };

  const handleUndo = useCallback(() => {
    state.undo();
    setTimeout(playOnce, 50);
  }, [playOnce, state]);

  const handleRedo = useCallback(() => {
    state.redo();
    setTimeout(playOnce, 50);
  }, [playOnce, state]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleUndo, handleRedo]);

  const handleDownload = async () => {
    const s = stateRef.current;
    if (s.notes.length === 0) return;
    setIsExporting(true);
    const beatTime = 60 / s.bpm / 4;
    let maxDur = 0;

    s.notes.forEach((n: Note) => {
      const parts = n.time.split(":").map(Number);
      const d =
        (parts[1] * 4 + parts[2]) * beatTime +
        n.width * beatTime +
        s.release +
        s.delayFeedback * 5;
      if (d > maxDur) maxDur = d;
    });

    try {
      const offlineBuffer = await Tone.Offline(() => {
        const polyCount = s.notes.length;

        s.notes.forEach((note) => {
          const parts = note.time.split(":").map(Number);
          const startTime = (parts[1] * 4 + parts[2]) * beatTime;
          const totalDuration = note.width * beatTime;

          const { source, filter } = createSynthChain(
            s,
            Tone.getDestination(),
            polyCount
          );

          if (s.filterEnvAmount !== 0) {
            filter.detune.setValueAtTime(0, startTime);
            filter.detune.linearRampToValueAtTime(
              s.filterEnvAmount,
              startTime + s.attack
            );
            filter.detune.linearRampToValueAtTime(
              0,
              startTime + s.attack + s.decay
            );
          }

          if (s.repeatSpeed > 0) {
            const interval = 1 / s.repeatSpeed;
            let t = 0;
            let count = 0;
            while (t < totalDuration) {
              const triggerTime = startTime + t;
              const singleNoteDur = Math.min(interval * 0.9, totalDuration - t);

              if (s.oscillatorType === "noise") {
                source.triggerAttackRelease(singleNoteDur, triggerTime);
              } else {
                const baseFreq = Tone.Frequency(note.pitch).toFrequency();
                const arpFreq =
                  baseFreq * Math.pow(2, (s.arpAmount * count) / 12);

                source.detune.setValueAtTime(0, triggerTime);
                source.triggerAttackRelease(
                  arpFreq,
                  singleNoteDur,
                  triggerTime
                );

                if (s.pitchAmount !== 0) {
                  source.detune.linearRampToValueAtTime(
                    s.pitchAmount * 100,
                    triggerTime + s.pitchTime
                  );
                }
              }
              t += interval;
              count++;
            }
          } else {
            if (s.oscillatorType === "noise") {
              source.triggerAttackRelease(totalDuration, startTime);
            } else {
              source.detune.setValueAtTime(0, startTime);
              source.triggerAttackRelease(note.pitch, totalDuration, startTime);

              if (s.pitchAmount !== 0) {
                source.detune.linearRampToValueAtTime(
                  s.pitchAmount * 100,
                  startTime + s.pitchTime
                );
              }
            }
          }
        });
      }, maxDur + 0.5);

      const finalBuffer = offlineBuffer.get();
      if (!finalBuffer) return;
      const wav = audioBufferToWav(finalBuffer);
      const blob = new Blob([wav], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.download = `se_${Date.now()}.wav`;
      a.href = url;
      a.click();
      showToast("DOWNLOAD STARTED", "success");
    } catch (e) {
      showToast("DOWNLOAD FAILED", "error");
    } finally {
      setIsExporting(false);
    }
  };

  const audioBufferToWav = (buffer: AudioBuffer) => {
    const numOfChannels = buffer.numberOfChannels;
    const length = buffer.length * numOfChannels * 2 + 44;
    const out = new ArrayBuffer(length);
    const view = new DataView(out);
    const sampleRate = buffer.sampleRate;
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++)
        view.setUint8(offset + i, string.charCodeAt(i));
    };
    writeString(0, "RIFF");
    view.setUint32(4, length - 8, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numOfChannels * 2, true);
    view.setUint16(32, numOfChannels * 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, length - 44, true);
    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let ch = 0; ch < numOfChannels; ch++) {
        let s = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        offset += 2;
      }
    }
    return out;
  };

  const savePreset = () => {
    if (!presetName.trim()) {
      showToast("名前を入力してください", "error");
      return;
    }
    const s = stateRef.current;
    const isOverwrite = s.history.some((h: Preset) => h.name === presetName);
    const newPreset: Preset = {
      version: 1,
      name: presetName,
      params: {
        bpm: s.bpm,
        delayFeedback: s.delayFeedback,
        filterCutoff: s.filterCutoff,
        filterEnvAmount: s.filterEnvAmount,
        oscillatorType: s.oscillatorType,
        attack: s.attack,
        decay: s.decay,
        sustain: s.sustain,
        release: s.release,
        pitchAmount: s.pitchAmount,
        pitchTime: s.pitchTime,
        masterVolume: s.masterVolume,
        repeatSpeed: s.repeatSpeed,
        arpAmount: s.arpAmount,
      },
      notes: [...s.notes],
    };
    const newHistory = [
      newPreset,
      ...s.history.filter((h) => h.name !== presetName),
    ];
    state.setHistory(newHistory);
    showToast(
      isOverwrite ? `OVERWRITTEN: ${presetName}` : `SAVED: ${presetName}`,
      "success"
    );
  };

  const loadPreset = (name: string) => {
    if (!name) {
      setPresetName("");
      return;
    }
    const p = state.history.find((h) => h.name === name);
    if (!p) return;
    state.pushHistory();
    state.setAllParams({ ...DEFAULT_STATE, ...p.params });
    state.clearNotes();
    p.notes.forEach((n) => state.addNote(n));
    setPresetName(p.name);
    showToast(`LOADED: ${p.name}`, "success");
    setTimeout(playOnce, 50);
  };

  const deletePreset = () => {
    if (!presetName) return;
    setConfirmData({
      msg: `"${presetName}" をプリセット履歴から削除しますか？`,
      onConfirm: () => {
        state.setHistory(state.history.filter((h) => h.name !== presetName));
        showToast(`DELETED: ${presetName}`, "success");
        setPresetName("");
        setConfirmData(null);
      },
    });
  };

  const clearAllNotes = () => {
    setConfirmData({
      msg: "すべてのノートを消去しますか？",
      onConfirm: () => {
        state.pushHistory();
        handleUserChange();
        state.clearNotes();
        showToast("CLEARED ALL NOTES", "success");
        setConfirmData(null);
      },
    });
  };

  const exportHistory = () => {
    const s = stateRef.current;
    const exportData = {
      current: {
        params: {
          bpm: s.bpm,
          delayFeedback: s.delayFeedback,
          filterCutoff: s.filterCutoff,
          filterEnvAmount: s.filterEnvAmount,
          oscillatorType: s.oscillatorType,
          attack: s.attack,
          decay: s.decay,
          sustain: s.sustain,
          release: s.release,
          pitchAmount: s.pitchAmount,
          pitchTime: s.pitchTime,
          masterVolume: s.masterVolume,
          repeatSpeed: s.repeatSpeed,
          arpAmount: s.arpAmount,
        },
        notes: s.notes,
      },
      history: s.history,
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.download = `se_composer_data_${Date.now()}.json`;
    a.href = url;
    a.click();
    showToast("DATA EXPORTED", "success");
  };

  const importHistory = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        state.pushHistory();
        if (data.history && Array.isArray(data.history)) {
          state.setHistory(data.history);
          if (data.current) {
            state.setAllParams(data.current.params);
            state.clearNotes();
            data.current.notes.forEach((n: any) => state.addNote(n));
          }
          showToast(`IMPORTED PRESETS & CURRENT STATE`, "success");
        } else if (Array.isArray(data)) {
          state.setHistory(data);
          showToast(`IMPORTED ${data.length} PRESETS`, "success");
        }
      } catch (err) {
        showToast("INVALID JSON", "error");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const applyPreset = (type: string) => {
    state.pushHistory();
    handleUserChange();
    let p: any = { ...DEFAULT_STATE };
    const r = (min: number, max: number) => Math.random() * (max - min) + min;
    switch (type) {
      case "laser":
        p = {
          ...p,
          oscillatorType: "sawtooth",
          pitchAmount: r(35, -10),
          pitchTime: r(0.12, 0.25),
          filterCutoff: r(4000, 8000),
          filterEnvAmount: r(2000, 5000),
        };
        break;
      case "bomb":
        p = {
          ...p,
          oscillatorType: "noise",
          decay: r(0.5, 1.5),
          sustain: 0,
          release: r(1.0, 2.5),
          filterCutoff: r(200, 500),
        };
        break;
      case "positive":
        p = {
          ...p,
          oscillatorType: "triangle",
          pitchAmount: r(12, 36),
          pitchTime: r(0.03, 0.1),
        };
        break;
      case "negative":
        p = {
          ...p,
          oscillatorType: "square",
          pitchAmount: r(-36, -12),
          pitchTime: r(0.3, 0.6),
        };
        break;
      case "hit":
        p = {
          ...p,
          oscillatorType: "square",
          attack: 0.001,
          decay: 0.05,
          sustain: 0,
          release: 0.1,
        };
        break;
      case "jump":
        p = {
          ...p,
          oscillatorType: "sine",
          pitchAmount: r(12, 48),
          pitchTime: 0.1,
        };
        break;
      default:
        p = {
          ...p,
          oscillatorType: ["sine", "square", "sawtooth", "triangle", "noise"][
            Math.floor(Math.random() * 5)
          ],
          attack: r(0.01, 0.5),
          release: r(0.1, 2.0),
        };
    }
    p.masterVolume = -6;
    state.setAllParams(p);
    if (state.notes.length === 0)
      state.addNote({
        id: "preview",
        time: "0:0:0",
        pitch: "C5",
        width: 2,
        velocity: 0.8,
      });
    setTimeout(playOnce, 50);
  };

  return (
    <div style={containerS}>
      {toast && (
        <div
          style={{
            ...toastS,
            backgroundColor: toast.type === "success" ? "#10b981" : "#f43f5e",
          }}
        >
          {toast.msg}
        </div>
      )}

      {confirmData && (
        <div style={overlayS}>
          <div style={modalS}>
            <AlertTriangle
              size={32}
              color="#f43f5e"
              style={{ marginBottom: "12px" }}
            />
            <div
              style={{
                fontSize: "14px",
                fontWeight: "bold",
                marginBottom: "20px",
                color: "#f8fafc",
              }}
            >
              {confirmData.msg}
            </div>
            <div
              style={{ display: "flex", gap: "12px", justifyContent: "center" }}
            >
              <button onClick={() => setConfirmData(null)} style={modalBtnS}>
                CANCEL
              </button>
              <button
                onClick={confirmData.onConfirm}
                style={{ ...modalBtnS, backgroundColor: "#f43f5e" }}
              >
                DELETE
              </button>
            </div>
          </div>
        </div>
      )}

      <h2
        style={{ color: "#f8fafc", margin: "0 0 20px 0", letterSpacing: "2px" }}
      >
        WEB SE COMPOSER
      </h2>

      <div style={pianoRollWrapperS} onMouseDown={handleUserChange}>
        <PianoRoll />
      </div>

      <div style={flexCenterS}>
        <button
          onClick={isPlaying ? stopAndDispose : playOnce}
          style={playBtnS}
        >
          {isPlaying ? <Square size={18} /> : <Play size={18} />}{" "}
          {isPlaying ? "STOP" : "PLAY"}
        </button>

        <div style={{ display: "flex", gap: "4px", margin: "0 10px" }}>
          <button
            onClick={handleUndo}
            disabled={state.past.length === 0}
            style={historyBtnS}
            title="Undo (Ctrl+Z)"
          >
            <Undo2 size={16} />
          </button>
          <button
            onClick={handleRedo}
            disabled={state.future.length === 0}
            style={historyBtnS}
            title="Redo (Ctrl+Y)"
          >
            <Redo2 size={16} />
          </button>
        </div>

        <button
          onClick={handleDownload}
          disabled={isExporting}
          style={{
            ...playBtnS,
            backgroundColor: "#10b981",
            marginLeft: "12px",
          }}
        >
          <Download size={18} /> {isExporting ? "EXPORTING..." : "WAV"}
        </button>
      </div>

      <div style={managerContainerS}>
        <div style={inputGroupS}>
          <select
            value={presetName}
            onChange={(e) => loadPreset(e.target.value)}
            style={selectS}
          >
            <option
              value=""
              style={{ backgroundColor: "#1e293b", color: "#f8fafc" }}
            >
              -- PRESET HISTORY --
            </option>
            {state.history.map((h: Preset) => (
              <option
                key={h.name}
                value={h.name}
                style={{ backgroundColor: "#1e293b", color: "#f8fafc" }}
              >
                {h.name}
              </option>
            ))}
          </select>
          <button
            onClick={exportHistory}
            style={iconBtnS}
            title="Export JSON (↑)"
          >
            <FileUp size={16} />
          </button>
          <label
            style={{ ...iconBtnS, cursor: "pointer" }}
            title="Import JSON (↓)"
          >
            <FileDown size={16} />
            <input
              type="file"
              accept=".json"
              onChange={importHistory}
              style={{ display: "none" }}
            />
          </label>
        </div>
        <div style={inputGroupS}>
          <input
            type="text"
            placeholder="Preset Name..."
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            style={nameInputS}
          />
          <button onClick={savePreset} style={saveBtnS}>
            <Save size={14} /> SAVE
          </button>
          <button
            onClick={deletePreset}
            style={{ ...saveBtnS, backgroundColor: "#f43f5e" }}
          >
            DEL
          </button>
        </div>
      </div>

      <div style={flexCenterS}>
        <div style={inputGroupS}>
          {["laser", "bomb", "positive", "negative", "hit", "jump"].map((t) => (
            <button key={t} onClick={() => applyPreset(t)} style={sampleBtnS}>
              {t.toUpperCase()}
            </button>
          ))}
          <button
            onClick={() => applyPreset("random")}
            style={{ ...sampleBtnS, borderColor: "#3b82f6", color: "#3b82f6" }}
          >
            <Shuffle size={12} /> RANDOM
          </button>
        </div>
        <div style={inputGroupS}>
          <Waves size={16} color="#94a3b8" />
          <select
            value={state.oscillatorType}
            onChange={(e) => {
              state.pushHistory();
              handleUserChange();
              state.setOscillatorType(e.target.value as any);
            }}
            style={selectS}
          >
            {["sine", "triangle", "square", "sawtooth", "noise"].map((o) => (
              <option
                key={o}
                value={o}
                style={{ backgroundColor: "#1e293b", color: "#f8fafc" }}
              >
                {o.toUpperCase()}
              </option>
            ))}
          </select>
          <Clock size={16} color="#94a3b8" />
          <input
            type="number"
            value={state.bpm}
            onChange={(e) => {
              state.pushHistory();
              handleUserChange();
              state.setBpm(Number(e.target.value));
            }}
            style={bpmS}
          />
        </div>
        <button onClick={clearAllNotes} style={iconBtnS} title="Clear Notes">
          <Trash2 size={20} color="#f43f5e" />
        </button>
      </div>

      <div style={categoryGridS}>
        <div style={categoryBoxS}>
          <div style={categoryTitleS}>
            <Activity size={14} /> OSC & ENVELOPE
          </div>
          <Panel
            title="ATTACK"
            val={state.attack}
            min={0}
            max={2}
            step={0.01}
            onChange={(v: any) =>
              onParamEdit(v, (val) => state.setEnvelope("attack", val))
            }
          />
          <Panel
            title="DECAY"
            val={state.decay}
            min={0.01}
            max={2}
            step={0.01}
            onChange={(v: any) =>
              onParamEdit(v, (val) => state.setEnvelope("decay", val))
            }
          />
          <Panel
            title="SUSTAIN"
            val={state.sustain}
            min={0}
            max={1}
            step={0.01}
            onChange={(v: any) =>
              onParamEdit(v, (val) => state.setEnvelope("sustain", val))
            }
          />
          <Panel
            title="RELEASE"
            val={state.release}
            min={0.01}
            max={3}
            step={0.01}
            onChange={(v: any) =>
              onParamEdit(v, (val) => state.setEnvelope("release", val))
            }
          />
        </div>
        <div style={categoryBoxS}>
          <div style={categoryTitleS}>
            <Music size={14} /> PITCH & ARPEGGIO
          </div>
          <Panel
            title="REPEAT SPEED (Hz)"
            val={state.repeatSpeed}
            min={0}
            max={100}
            step={0.1}
            onChange={(v: any) =>
              onParamEdit(v, (val) => state.setEffect("repeatSpeed", val))
            }
          />
          <Panel
            title="ARP AMOUNT (semi)"
            val={state.arpAmount}
            min={-12}
            max={12}
            step={1}
            onChange={(v: any) =>
              onParamEdit(v, (val) => state.setPitchEffect("arpAmount", val))
            }
          />
          <Panel
            title="PITCH AMOUNT"
            val={state.pitchAmount}
            min={-48}
            max={48}
            onChange={(v: any) =>
              onParamEdit(v, (val) => state.setPitchEffect("pitchAmount", val))
            }
          />
          <Panel
            title="PITCH TIME"
            val={state.pitchTime}
            min={0.01}
            max={1.5}
            step={0.01}
            onChange={(v: any) =>
              onParamEdit(v, (val) => state.setPitchEffect("pitchTime", val))
            }
          />
        </div>
        <div style={categoryBoxS}>
          <div style={categoryTitleS}>
            <Settings size={14} /> EFFECTS & MASTER
          </div>
          <Panel
            title="FILTER (Hz)"
            val={state.filterCutoff}
            min={100}
            max={10000}
            step={10}
            onChange={(v: any) =>
              onParamEdit(v, (val) => state.setEffect("filterCutoff", val))
            }
          />
          <Panel
            title="FILTER ENV"
            val={state.filterEnvAmount}
            min={0}
            max={10000}
            step={10}
            onChange={(v: any) =>
              onParamEdit(v, (val) => state.setEffect("filterEnvAmount", val))
            }
          />
          <Panel
            title="DELAY FEEDBACK"
            val={state.delayFeedback}
            min={0}
            max={0.9}
            step={0.01}
            onChange={(v: any) =>
              onParamEdit(v, (val) => state.setEffect("delayFeedback", val))
            }
          />
          <Panel
            title="MASTER VOL (dB)"
            val={state.masterVolume}
            min={-60}
            max={0}
            step={1}
            onChange={(v: any) =>
              onParamEdit(v, (val) => state.setEffect("masterVolume", val))
            }
          />
        </div>
      </div>
    </div>
  );
}

const Panel = ({ title, val, min, max, step = 1, onChange }: any) => (
  <div style={panelS}>
    <div
      style={{
        fontSize: "10px",
        fontWeight: "bold",
        marginBottom: "4px",
        color: "#64748b",
        textTransform: "uppercase",
      }}
    >
      {title}
    </div>
    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={val}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: "#3b82f6" }}
      />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={val}
        onChange={(e) => onChange(Number(e.target.value))}
        style={numInputS}
      />
    </div>
  </div>
);

// Styles
const toastS: any = {
  position: "fixed",
  top: "20px",
  left: "50%",
  transform: "translateX(-50%)",
  padding: "10px 30px",
  borderRadius: "30px",
  color: "white",
  fontWeight: "bold",
  fontSize: "13px",
  zIndex: 1000,
  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
  letterSpacing: "1px",
};
const overlayS: any = {
  position: "fixed",
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
  backgroundColor: "rgba(0,0,0,0.7)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 2000,
};
const modalS: any = {
  backgroundColor: "#1e293b",
  padding: "30px",
  borderRadius: "16px",
  border: "1px solid #334155",
  textAlign: "center",
  maxWidth: "400px",
  width: "90%",
};
const modalBtnS: any = {
  padding: "8px 24px",
  borderRadius: "6px",
  border: "none",
  backgroundColor: "#475569",
  color: "white",
  cursor: "pointer",
  fontWeight: "bold",
  fontSize: "12px",
};
const historyBtnS: any = {
  padding: "6px 12px",
  borderRadius: "6px",
  border: "1px solid #334155",
  backgroundColor: "#1e293b",
  color: "#f8fafc",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  opacity: 0.8,
};
const managerContainerS: any = {
  display: "flex",
  justifyContent: "center",
  gap: "12px",
  marginTop: "20px",
  flexWrap: "wrap",
};
const nameInputS: any = {
  border: "none",
  backgroundColor: "transparent",
  color: "#f8fafc",
  fontWeight: "bold",
  outline: "none",
  width: "120px",
};
const saveBtnS: any = {
  background: "#3b82f6",
  border: "none",
  color: "white",
  fontSize: "10px",
  padding: "4px 12px",
  borderRadius: "4px",
  cursor: "pointer",
  fontWeight: "bold",
  display: "flex",
  alignItems: "center",
  gap: "4px",
};
const categoryGridS: any = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
  gap: "20px",
  maxWidth: "1200px",
  margin: "40px auto",
  padding: "0 20px",
};
const categoryBoxS: any = {
  background: "#1e293b",
  borderRadius: "12px",
  border: "1px solid #334155",
  padding: "20px",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
};
const categoryTitleS: any = {
  fontSize: "12px",
  fontWeight: "bold",
  color: "#3b82f6",
  marginBottom: "10px",
  display: "flex",
  alignItems: "center",
  gap: "8px",
  borderBottom: "1px solid #334155",
  paddingBottom: "8px",
};
const numInputS: any = {
  width: "50px",
  backgroundColor: "#0f172a",
  color: "#3b82f6",
  border: "1px solid #334155",
  borderRadius: "4px",
  padding: "2px 4px",
  fontSize: "11px",
  textAlign: "right",
};
const sampleBtnS: any = {
  background: "transparent",
  border: "1px solid #475569",
  color: "#f8fafc",
  fontSize: "10px",
  padding: "4px 8px",
  borderRadius: "4px",
  cursor: "pointer",
  fontWeight: "bold",
};
const containerS: any = {
  padding: "20px",
  textAlign: "center",
  backgroundColor: "#0f172a",
  minHeight: "100vh",
  color: "#f8fafc",
  fontFamily: "sans-serif",
};
const pianoRollWrapperS: any = {
  backgroundColor: "#1e293b",
  padding: "20px",
  borderRadius: "12px",
  display: "inline-block",
  border: "1px solid #334155",
};
const flexCenterS: any = {
  marginTop: "20px",
  display: "flex",
  justifyContent: "center",
  gap: "12px",
  flexWrap: "wrap",
};
const playBtnS: any = {
  padding: "10px 24px",
  borderRadius: "8px",
  border: "none",
  backgroundColor: "#3b82f6",
  color: "white",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: "8px",
  fontWeight: "bold",
};
const inputGroupS: any = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  background: "#1e293b",
  padding: "8px 16px",
  borderRadius: "8px",
  border: "1px solid #334155",
};
const selectS: any = {
  border: "none",
  backgroundColor: "#1e293b",
  color: "#f8fafc",
  fontWeight: "bold",
  outline: "none",
  maxWidth: "150px",
  padding: "4px 8px",
  borderRadius: "4px",
};
const bpmS: any = {
  width: "45px",
  border: "none",
  backgroundColor: "transparent",
  color: "#f8fafc",
  textAlign: "center",
  fontWeight: "bold",
  outline: "none",
};
const iconBtnS: any = {
  padding: "8px",
  borderRadius: "8px",
  border: "1px solid #334155",
  backgroundColor: "#1e293b",
  cursor: "pointer",
  color: "#94a3b8",
  display: "flex",
  alignItems: "center",
};
const panelS: any = { textAlign: "left" };
