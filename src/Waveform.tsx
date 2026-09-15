import React, { useEffect, useRef, useState } from "react";
import { useStore } from "./store";
import { peekContext, renderPeaks } from "./audio/player";
import type { Peaks } from "./audio/player";
import type { PlaybackRange } from "./PianoRoll";
import { CANVAS_W, KEY_W, STEPS } from "./PianoRoll";

const HEIGHT = 96;
/** レンダリングは 3〜11ms だが、スライダーの連続変化で毎回走らせる必要はない */
const DEBOUNCE_MS = 80;
/**
 * 縦軸の曲げ具合。1 なら線形。SE は振幅 0.04（-28dB）程度のものが普通にあり、
 * 線形だと 96px の枠に対して平均 1.2px の直線にしかならない。
 *
 * dB スケール（-60dB を底にする）も試したが、-20dB 下が 0.67 になるほど持ち上げるため
 * 全体の 2割が上下に振り切った。0.5（平方根）だと同じところが 0.32 に収まり、
 * peak の -60dB 下でも 0 にならないので、波形の終端が消えずに済む。
 */
const GAMMA = 0.5;
/** 枠に対する最大の高さ。1.0 だと peak のところが上下の縁に接して潰れて見える */
const AMPLITUDE = 0.88;

/** peak を 1 とした相対値を、曲げてから -1〜1 に写す */
function toScale(v: number, peak: number): number {
  if (peak <= 0 || v === 0) return 0;
  return Math.pow(Math.min(1, Math.abs(v) / peak), GAMMA) * AMPLITUDE * Math.sign(v);
}

interface WaveformProps {
  playback: PlaybackRange | null;
}

export const Waveform: React.FC<WaveformProps> = ({ playback }) => {
  const params = useStore((s) => s.params);
  const notes = useStore((s) => s.notes);
  const exportSeconds = useStore((s) => s.exportSeconds);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const [peaks, setPeaks] = useState<Peaks | null>(null);

  /** 横軸に割り当てる時間。ピアノロールの 32ステップと一致させる */
  const windowSec = STEPS * (60 / params.bpm / 4);

  useEffect(() => {
    if (notes.length === 0) {
      setPeaks(null);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      void renderPeaks(params, notes, CANVAS_W, windowSec)
        .then((next) => {
          if (alive) setPeaks(next);
        })
        .catch(() => {
          if (alive) setPeaks(null);
        });
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [params, notes, windowSec]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#0b1120";
    ctx.fillRect(0, 0, CANVAS_W, HEIGHT);

    // ピアノロールと同じ位置・同じ色で引く。16分の線まで引くと波形が読めないので
    // そこだけ省いている（色を変えるのではなく引かない）
    for (let s = 0; s <= STEPS; s += 4) {
      ctx.strokeStyle = s % 16 === 0 ? "#475569" : "#334155";
      ctx.beginPath();
      ctx.moveTo(s * (CANVAS_W / STEPS) + 0.5, 0);
      ctx.lineTo(s * (CANVAS_W / STEPS) + 0.5, HEIGHT);
      ctx.stroke();
    }

    const mid = HEIGHT / 2;
    ctx.strokeStyle = "#1e293b";
    ctx.beginPath();
    ctx.moveTo(0, mid + 0.5);
    ctx.lineTo(CANVAS_W, mid + 0.5);
    ctx.stroke();

    // 尺を揃えるときは、この線から先が書き出しに入らない
    if (exportSeconds !== null) {
      const x = (exportSeconds / windowSec) * CANVAS_W;
      if (x < CANVAS_W) {
        ctx.fillStyle = "rgba(2, 6, 23, 0.55)";
        ctx.fillRect(x, 0, CANVAS_W - x, HEIGHT);
      }
      if (x <= CANVAS_W) {
        ctx.strokeStyle = "#f59e0b";
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, HEIGHT);
        ctx.stroke();
      }
    }

    if (!peaks || peaks.peakDb === -Infinity) return;

    const peak = Math.pow(10, peaks.peakDb / 20);
    for (let x = 0; x < CANVAS_W; x++) {
      const lo = peaks.min[x];
      const hi = peaks.max[x];
      if (lo === 0 && hi === 0) continue;
      // リミッターに当たっている区間は潰れている。作りながら気付けるように色を変える
      ctx.fillStyle = peaks.hot[x] ? "#f43f5e" : "#60a5fa";
      const top = mid - toScale(hi, peak) * mid;
      const bottom = mid - toScale(lo, peak) * mid;
      ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
    }
  }, [peaks, exportSeconds, windowSec]);

  // 再生カーソル。ピアノロールと同じ AudioContext の時計で走らせる
  useEffect(() => {
    const el = playheadRef.current;
    if (!el) return;
    const hide = () => {
      el.style.display = "none";
    };
    if (!playback) {
      hide();
      return;
    }
    let raf = 0;
    const tick = () => {
      const ctx = peekContext();
      if (!ctx) {
        hide();
        return;
      }
      const raw = ctx.currentTime - playback.startAt;
      // ループ中は周期で折り返す
      const elapsed = playback.loopSeconds ? raw % playback.loopSeconds : raw;
      const ratio = elapsed / windowSec;
      if (raw < 0 || ratio > 1) hide();
      else {
        el.style.display = "block";
        el.style.transform = `translateX(${ratio * CANVAS_W}px)`;
      }
      if (ctx.currentTime < playback.endAt) raf = requestAnimationFrame(tick);
      else hide();
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      hide();
    };
  }, [playback, windowSec]);

  const limit = exportSeconds ?? windowSec;
  const overflow = peaks !== null && peaks.seconds > limit + 0.001;

  return (
    // 横スクロールは持たせない。ピアノロールと別々にスクロールすると時間軸がずれる。
    // container の minWidth で全体が収まることを保証している
    <div style={{ display: "flex", alignItems: "flex-start", marginTop: 4 }}>
      {/* ピアノロールの鍵盤ぶんだけ空けて、波形の左端をグリッドの 0 に合わせる */}
      <div
        style={{
          // padding を含めて KEY_W に収める。はみ出すと波形ごと右にずれ、
          // ピアノロールと小節線が合わなくなる
          boxSizing: "border-box",
          width: KEY_W,
          flexShrink: 0,
          textAlign: "right",
          paddingRight: 5,
          fontSize: 9,
          color: "#64748b",
        }}
      >
        {peaks && (
          <>
            <div style={{ lineHeight: "13px" }}>{peaks.seconds.toFixed(2)}s</div>
            <div style={{ lineHeight: "13px", color: peaks.hot.some(Boolean) ? "#f43f5e" : "#64748b" }}>
              {peaks.peakDb > -Infinity ? `${peaks.peakDb.toFixed(1)}dB` : "-"}
            </div>
          </>
        )}
      </div>
      {/* border は canvas ではなくここに置く。canvas 側に付けると中身が 1px ずれて、
          ピアノロールの再生カーソルと位置が合わなくなる */}
      <div
        style={{
          position: "relative",
          flexShrink: 0,
          border: "1px solid #334155",
          borderRadius: 6,
          overflow: "hidden",
          lineHeight: 0,
        }}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={HEIGHT}
          style={{ display: "block", width: CANVAS_W, height: HEIGHT }}
        />
        <div
          ref={playheadRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 2,
            height: HEIGHT,
            background: "#f8fafc",
            opacity: 0.8,
            pointerEvents: "none",
            display: "none",
            willChange: "transform",
          }}
        />
        {overflow && (
          <span
            style={{
              position: "absolute",
              right: 4,
              top: 4,
              fontSize: 9,
              lineHeight: "12px",
              color: "#f59e0b",
              background: "rgba(2, 6, 23, 0.7)",
              borderRadius: 4,
              padding: "1px 4px",
            }}
            title={
              exportSeconds !== null
                ? `音の長さ ${peaks.seconds.toFixed(2)}s。指定の ${exportSeconds.toFixed(2)}s を超えた分は書き出しで切られる`
                : `音の長さ ${peaks.seconds.toFixed(2)}s。グリッド（${windowSec.toFixed(2)}s）を超えた分は表示されていない`
            }
          >
            はみ出し ▶
          </span>
        )}
      </div>
    </div>
  );
};
