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
  Zap,
} from "lucide-react";
import { useStore, OscillatorType, Preset, DEFAULT_STATE, Note } from "./store";
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

  // タイトル設定
  useEffect(() => {
    document.title = "SE-Composer";
  }, []);

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

  // 音声処理チェーン作成（LFO/Detune対応）
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
      
      // Detune (NoiseSynthには存在しないプロパティのためここで設定)
      if (source.detune) {
        source.detune.value = s.detune;
      }
    }
    source.volume.value = finalVolume;

    // LFO Implementation
    let lfo: any = null;
    if (s.lfoDepth > 0) {
      // Depthのスケーリング: 0-100 を適切な範囲にマップ
      const isPitch = s.lfoTarget === "pitch";
      const minVal = isPitch ? -s.lfoDepth * 10 : -s.lfoDepth * 20; // Pitch: +/- 1000cents, Filter: +/- 2000Hz
      const maxVal = isPitch ? s.lfoDepth * 10 : s.lfoDepth * 20;
      
      lfo = new Tone.LFO(s.lfoRate, minVal, maxVal).start();
      
      if (isPitch && s.oscillatorType !== "noise") {
         // Noiseにはピッチがないため除外
         lfo.connect(source.detune);
      } else if (!isPitch) {
         lfo.connect(filter.frequency);
      }
    }
    
    return { source, filter, delay, limiter, lfo };
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

      const { source, filter, delay, limiter, lfo } = createSynthChain(
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
            source.detune.setValueAtTime(s.detune, triggerTime); // Detune再適用
            source.triggerAttackRelease(arpFreq, singleNoteDur, triggerTime);
            if (s.pitchAmount !== 0)
              source.detune.linearRampToValueAtTime(
                s.detune + s.pitchAmount * 100,
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
          source.detune.setValueAtTime(s.detune, startTime);
          source.triggerAttackRelease(note.pitch, totalDuration, startTime);
          if (s.pitchAmount !== 0)
            source.detune.linearRampToValueAtTime(
              s.detune + s.pitchAmount * 100,
              startTime + s.pitchTime
            );
        }
      }

      const stopSelf = () => {
        source.volume.rampTo(-Infinity, 0.1);
        setTimeout(() => {
          [source, delay, filter, limiter, lfo].forEach((n) => {
            try {
              n?.dispose();
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

  const onParamStart = () => {
    state.pushHistory();
    handleUserChange();
  };

  const onParamChange = (v: number, setter: (v: number) => void) => {
    setter(v);
  };

  const onParamEnd = () => {
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
      const offlineBuffer = await Tone.Offline((context) => {
        const polyCount = s.notes.length;
        
        s.notes.forEach((note) => {
          const parts = note.time.split(":").map(Number);
          const startTime = (parts[1] * 4 + parts[2]) * beatTime;
          const totalDuration = note.width * beatTime;
          
          const { source, filter, lfo } = createSynthChain(
            s,
            context.destination,
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
                
                source.detune.setValueAtTime(s.detune, triggerTime);
                source.triggerAttackRelease(arpFreq, singleNoteDur, triggerTime);
                
                if (s.pitchAmount !== 0) {
                  source.detune.linearRampToValueAtTime(
                    s.detune + s.pitchAmount * 100,
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
              source.detune.setValueAtTime(s.detune, startTime);
              source.triggerAttackRelease(note.pitch, totalDuration, startTime);
              
              if (s.pitchAmount !== 0) {
                source.detune.linearRampToValueAtTime(
                  s.detune + s.pitchAmount * 100,
                  startTime + s.pitchTime
                );
              }
            }
          }
        });
      }, maxDur + 0.5);

      const finalBuffer = offlineBuffer.get();
      if (!finalBuffer) throw new Error("Buffer generation failed");
      
      const wav = audioBufferToWav(finalBuffer);
      const blob = new Blob([wav], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement("a");
      a.download = `se_${Date.now()}.wav`;
      a.href = url;
      document.body.appendChild(a); 
      a.click();
      document.body.removeChild(a);
      
      showToast("DOWNLOAD STARTED", "success");
    } catch (e) {
      console.error(e);
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
        lfoRate: s.lfoRate,
        lfoDepth: s.lfoDepth,
        lfoTarget: s.lfoTarget,
        detune: s.detune,
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
          lfoRate: s.lfoRate,
          lfoDepth: s.lfoDepth,
          lfoTarget: s.lfoTarget,
          detune: s.detune,
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

    const ensureNote = (pitch: string, width: number = 1) => {
       if (state.notes.length === 0)
        state.addNote({
          id: "preview",
          time: "0:0:0",
          pitch: pitch,
          width: width,
          velocity: 0.8,
        });
    }

    switch (type) {
      case "laser":
        p = {
          ...p,
          oscillatorType: Math.random() > 0.5 ? "sawtooth" : "square",
          pitchAmount: r(24, 48) * (Math.random() > 0.5 ? 1 : -1),
          pitchTime: r(0.1, 0.4),
          filterCutoff: r(1000, 8000),
          filterEnvAmount: r(1000, 6000),
          decay: r(0.1, 0.4),
          sustain: r(0, 0.2),
          release: r(0.1, 0.5),
          delayFeedback: r(0.1, 0.4),
          // LFOでうねりを追加
          lfoRate: r(5, 15),
          lfoDepth: Math.random() > 0.5 ? r(5, 20) : 0,
          lfoTarget: "filter",
        };
        ensureNote("C5", 2);
        break;
        
      case "bomb":
        p = {
          ...p,
          oscillatorType: "noise",
          decay: r(0.5, 2.0),
          sustain: 0,
          release: r(1.0, 3.0),
          filterCutoff: r(300, 1000),
          filterEnvAmount: r(500, 2000),
          attack: 0.01,
          masterVolume: -3,
          lfoRate: r(0.1, 2),
          lfoDepth: r(10, 50),
          lfoTarget: "filter",
        };
        ensureNote("C2", 4);
        break;
        
      case "coin":
        p = {
          ...p,
          oscillatorType: Math.random() > 0.5 ? "sine" : "triangle",
          pitchAmount: 0, 
          attack: 0.005,
          decay: r(0.1, 0.3),
          sustain: 0,
          release: r(0.1, 0.4),
          arpAmount: Math.random() > 0.5 ? 0 : 12,
          repeatSpeed: Math.random() > 0.7 ? r(15, 25) : 0,
          filterCutoff: 8000,
          detune: r(0, 10), // 微妙な厚み
        };
        ensureNote("C6", 1);
        break;

      case "powerup":
        p = {
          ...p,
          oscillatorType: "square",
          attack: r(0.01, 0.1),
          decay: r(0.2, 0.5),
          sustain: 0.4,
          release: 0.5,
          pitchAmount: r(12, 24),
          pitchTime: 0.3,
          repeatSpeed: r(10, 30),
          arpAmount: r(1, 5),
          filterCutoff: r(2000, 5000),
          delayFeedback: 0.3,
          lfoRate: r(2, 8),
          lfoDepth: r(5, 15),
          lfoTarget: "pitch", // 揺れる上昇音
        };
        ensureNote("C4", 3);
        break;

      case "damage":
        p = {
          ...p,
          oscillatorType: Math.random() > 0.5 ? "sawtooth" : "square",
          pitchAmount: r(-24, -12),
          pitchTime: r(0.05, 0.2),
          attack: 0.01,
          decay: 0.2,
          sustain: 0.1,
          release: 0.2,
          repeatSpeed: r(20, 50),
          arpAmount: r(-6, -1),
          filterCutoff: r(1000, 3000),
          lfoRate: r(10, 20),
          lfoDepth: r(20, 50),
          lfoTarget: "pitch", // 激しいビブラートで痛みを表現
        };
        ensureNote("C3", 1);
        break;

      case "jump":
        p = {
          ...p,
          oscillatorType: Math.random() > 0.5 ? "sine" : "square",
          pitchAmount: r(12, 36),
          pitchTime: r(0.1, 0.3),
          attack: 0.01,
          decay: 0.2,
          sustain: 0.1,
          release: 0.2,
        };
        ensureNote("C4", 1);
        break;

      case "random":
        const types: OscillatorType[] = ["sine", "square", "sawtooth", "triangle", "noise"];
        p = {
          ...p,
          oscillatorType: types[Math.floor(Math.random() * types.length)],
          attack: r(0.001, 0.5),
          decay: r(0.05, 1.0),
          sustain: r(0, 0.8),
          release: r(0.05, 2.0),
          
          pitchAmount: r(-48, 48),
          pitchTime: r(0.01, 1.0),
          
          filterCutoff: r(100, 8000),
          filterEnvAmount: r(0, 5000),
          
          repeatSpeed: Math.random() > 0.6 ? r(0, 40) : 0, 
          arpAmount: Math.floor(r(-12, 12)),
          
          delayFeedback: Math.random() > 0.5 ? r(0, 0.6) : 0,
          
          // LFO & Detune Random
          lfoRate: r(0.1, 20),
          lfoDepth: Math.random() > 0.5 ? r(0, 80) : 0,
          lfoTarget: Math.random() > 0.5 ? "pitch" : "filter",
          detune: Math.random() > 0.5 ? r(0, 50) : 0,
        };
        ensureNote("C4", 2);
        break;
        
      default:
        break;
    }
    
    p.masterVolume = -6;
    state.setAllParams(p);
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
          {["laser", "coin", "jump", "powerup", "damage", "bomb"].map((t) => (
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
              setTimeout(playOnce, 50);
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
            onStart={onParamStart}
            onChange={(v: any) =>
              onParamChange(v, (val) => state.setEnvelope("attack", val))
            }
            onEnd={onParamEnd}
          />
          <Panel
            title="DECAY"
            val={state.decay}
            min={0.01}
            max={2}
            step={0.01}
            onStart={onParamStart}
            onChange={(v: any) =>
              onParamChange(v, (val) => state.setEnvelope("decay", val))
            }
            onEnd={onParamEnd}
          />
          <Panel
            title="SUSTAIN"
            val={state.sustain}
            min={0}
            max={1}
            step={0.01}
            onStart={onParamStart}
            onChange={(v: any) =>
              onParamChange(v, (val) => state.setEnvelope("sustain", val))
            }
            onEnd={onParamEnd}
          />
          <Panel
            title="RELEASE"
            val={state.release}
            min={0.01}
            max={3}
            step={0.01}
            onStart={onParamStart}
            onChange={(v: any) =>
              onParamChange(v, (val) => state.setEnvelope("release", val))
            }
            onEnd={onParamEnd}
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
            onStart={onParamStart}
            onChange={(v: any) =>
              onParamChange(v, (val) => state.setEffect("repeatSpeed", val))
            }
            onEnd={onParamEnd}
          />
          <Panel
            title="ARP AMOUNT (semi)"
            val={state.arpAmount}
            min={-12}
            max={12}
            step={1}
            onStart={onParamStart}
            onChange={(v: any) =>
              onParamChange(v, (val) => state.setPitchEffect("arpAmount", val))
            }
            onEnd={onParamEnd}
          />
          <Panel
            title="PITCH AMOUNT"
            val={state.pitchAmount}
            min={-48}
            max={48}
            onStart={onParamStart}
            onChange={(v: any) =>
              onParamChange(v, (val) => state.setPitchEffect("pitchAmount", val))
            }
            onEnd={onParamEnd}
          />
          <Panel
            title="PITCH TIME"
            val={state.pitchTime}
            min={0.01}
            max={1.5}
            step={0.01}
            onStart={onParamStart}
            onChange={(v: any) =>
              onParamChange(v, (val) => state.setPitchEffect("pitchTime", val))
            }
            onEnd={onParamEnd}
          />
        </div>
        
        {/* New Category: MODULATION */}
        <div style={categoryBoxS}>
          <div style={categoryTitleS}>
            <Zap size={14} /> MODULATION (LFO)
          </div>
          <Panel
            title="LFO RATE (Hz)"
            val={state.lfoRate}
            min={0.1}
            max={20}
            step={0.1}
            onStart={onParamStart}
            onChange={(v: any) =>
              onParamChange(v, (val) => state.setModulation("lfoRate", val))
            }
            onEnd={onParamEnd}
          />
          <Panel
            title="LFO DEPTH"
            val={state.lfoDepth}
            min={0}
            max={100}
            step={1}
            onStart={onParamStart}
            onChange={(v: any) =>
              onParamChange(v, (val) => state.setModulation("lfoDepth", val))
            }
            onEnd={onParamEnd}
          />
          <div style={{ ...panelS, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
            <div style={{ fontSize: "10px", fontWeight: "bold", color: "#64748b", textTransform: "uppercase" }}>TARGET</div>
            <div style={{ display: 'flex', gap: '8px' }}>
               <button 
                 onClick={() => { onParamStart(); state.setModulation("lfoTarget", "pitch"); onParamEnd(); }}
                 style={state.lfoTarget === "pitch" ? activeToggleS : toggleS}
               >PITCH</button>
               <button 
                 onClick={() => { onParamStart(); state.setModulation("lfoTarget", "filter"); onParamEnd(); }}
                 style={state.lfoTarget === "filter" ? activeToggleS : toggleS}
               >FILTER</button>
            </div>
          </div>
           <Panel
            title="DETUNE (cents)"
            val={state.detune}
            min={0}
            max={50}
            step={1}
            onStart={onParamStart}
            onChange={(v: any) =>
              onParamChange(v, (val) => state.setModulation("detune", val))
            }
            onEnd={onParamEnd}
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
            onStart={onParamStart}
            onChange={(v: any) =>
              onParamChange(v, (val) => state.setEffect("filterCutoff", val))
            }
            onEnd={onParamEnd}
          />
          <Panel
            title="FILTER ENV"
            val={state.filterEnvAmount}
            min={0}
            max={10000}
            step={10}
            onStart={onParamStart}
            onChange={(v: any) =>
              onParamChange(v, (val) => state.setEffect("filterEnvAmount", val))
            }
            onEnd={onParamEnd}
          />
          <Panel
            title="DELAY FEEDBACK"
            val={state.delayFeedback}
            min={0}
            max={0.9}
            step={0.01}
            onStart={onParamStart}
            onChange={(v: any) =>
              onParamChange(v, (val) => state.setEffect("delayFeedback", val))
            }
            onEnd={onParamEnd}
          />
          <Panel
            title="MASTER VOL (dB)"
            val={state.masterVolume}
            min={-60}
            max={0}
            step={1}
            onStart={onParamStart}
            onChange={(v: any) =>
              onParamChange(v, (val) => state.setEffect("masterVolume", val))
            }
            onEnd={onParamEnd}
          />
        </div>
      </div>
    </div>
  );
}

const Panel = ({ title, val, min, max, step = 1, onStart, onChange, onEnd }: any) => (
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
        onPointerDown={onStart}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onEnd}
        style={{ flex: 1, accentColor: "#3b82f6" }}
      />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={val}
        onChange={(e) => {
            if (onStart) onStart();
            onChange(Number(e.target.value));
            if (onEnd) onEnd();
        }}
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
const toggleS: any = {
  background: "#0f172a",
  border: "1px solid #334155",
  color: "#64748b",
  fontSize: "10px",
  padding: "2px 6px",
  borderRadius: "4px",
  cursor: "pointer",
  fontWeight: "bold",
};
const activeToggleS: any = {
  ...toggleS,
  background: "#3b82f6",
  color: "white",
  borderColor: "#3b82f6",
};