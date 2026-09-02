# 設計メモ

次に手を入れるときのための記録。**特に「音の再現のために意図的にそうしている」項目は、
知らずに直すと既存のSEが全部変わる。**

## 全体構造

```
src/core/engine.js    音源。UI と CLI の唯一の実装。素の Web Audio のみ、外部依存なし
src/core/engine.d.ts  上の型定義（実装は .js、TS から使うため手書き）
src/core/wav.js       WAVエンコード・末尾トリム・正規化・波形統計
src/audio/player.ts   ブラウザ再生とオフラインレンダリング（engine を呼ぶだけ）
src/store.ts          状態（zustand）、undo/redo、localStorage
src/App.tsx           画面の組み立てとプリセット入出力
src/PianoRoll.tsx     C2〜C7 × 32ステップのグリッド
src/randomize.ts      カテゴリ別のランダム生成（UIのサンプルボタン）
cli/render.mjs        CLI。engine と wav を Node から呼ぶ
presets/*.json        プリセット実例
```

`engine.js` が JS なのは、ブラウザ（Vite/TS）と Node（`node cli/render.mjs`）の両方から
ビルドなしで読めるようにするため。型は隣の `.d.ts` で与えている。**音に関わる変更は必ず
engine.js に入れる。** UI 側や CLI 側にロジックを複製すると、両者の音がずれた瞬間に
「JSONで共有できる」という前提が崩れる。

音源は `AudioContext` を引数で受け取る純粋な組み立て関数で、`schedule(ctx, params, notes,
destination, when)` がすべてを行う。ブラウザは `AudioContext`、CLI は
`node-web-audio-api` の `OfflineAudioContext` を渡す。

## v1（Tone.js 版）から引き継いだ挙動

v2 は Tone.js を外したが、**音は v1 を正とした**。以下は「Tone がそう振る舞っていたから
そうしている」もので、素直に書き直すと音が変わる。

| 箇所 | 挙動 | 理由 |
|---|---|---|
| エンベロープの decay/release | `setTargetAtTime` による指数接近。時定数は `ln(rampTime+1)/ln(200)` | Tone.Envelope の実装。「指定時刻にちょうど0に到達する ramp」にすると裾が痩せて余韻が消える |
| `triggerAttack` | 現在値から `(1-current)×attack` の時間で頂点へ | Tone と同じ。連打すると値が積み上がって滑らかにつながる（これが無いと連打が「カクカク」になる） |
| `sustain: 0` | attack+decay で発音を止め、release を待たない | Tone.Synth / NoiseSynth の仕様 |
| ディレイ | 100% wet（原音がディレイを通って遅れる）、間隔は **0.25秒固定** | v1 は `FeedbackDelay("8n")` を使いつつ `Tone.Transport.bpm` を設定していなかったため、プリセットの bpm に関係なく常に 120BPM の8分音符だった |
| チェーン構成 | ノートごとに delay/filter/limiter を独立して作る | v1 と同じ。フィルタエンベロープがノート単位で効く |
| detune | ノート内では1本の `ConstantSourceNode` を共有し、全オシレータへ配る | v1 の `Tone.Synth.detune`（Signal）と同じ。`pitchTime` が連打間隔より長いと、ランプの終端が数 hit 先に届いて急峻に跳ね上がる。譜面から想像する音ではないが、既存プリセットの「跳ね」はこれ |
| 音量補正 | `masterVolume - log10(同時発音数) × 15` dB | v1 と同じ 15dB/decade |
| 発音体 | 音程を持つ音は常に1つ。次の hit の時刻で前を止める | v1（Tone.Source）は再トリガのたびに restart していた。止めないと repeat で音が積み重なって歪む |

## v1 から意図的に変えた点

| 変更 | 理由 |
|---|---|
| `pitch` の無いノートを読み飛ばす | v1 のピアノロールが残した壊れたデータが実在する。v1 は描画も再生もしなかったので、既定値で補うと元データに無い音が鳴る。**ただし v1 は音量補正の分母には数えていた**ため、そういうノートを含むプリセットは v2 のほうが大きくなる |
| `velocity` を音量に反映 | v1 は Note 型に持っていながら未使用（常に 1.0 相当）だった |
| 音量補正の分母を「譜面上の総ノート数」→「同時発音数」 | 時間をずらして並べただけのメロディまで小さくなるのを避けるため。SE は同時発音が大半なので実測はほぼ一致する |
| ノイズを固定シードの PRNG + キャッシュに | v1（Tone.Noise）はバッファをキャッシュしつつ再生ごとにランダムな位置から鳴らすので、連続して鳴らすと音が変わっていた。SE ツールとしては「同じ設定なら同じ音」が正しい |

## 実装上の罠

- **`node-web-audio-api` では `stop()` を2回呼べない**（`InvalidStateError: cannot stop before start`）。
  停止時刻は1回で決める必要があり、`schedule` が次の hit の時刻を先に計算しているのはこのため
- **`cancelScheduledValues` は進行中の ramp の終点イベントごと消す**ので、補間が壊れる。
  値を保持したいときは `cancelAndHoldAtTime` を使う
- **AudioParam には現在値を読む API が無い**（`Tone.Signal.getValueAtTime` に相当するものがない）。
  `createEnvelope` が JS 側で値を追跡しているのはこのため。エンベロープの数式を変えるときは
  実際にスケジュールする自動化と追跡側の両方を必ず揃える
- **canvas を flex コンテナに入れると `align-items: stretch` で高さが潰れる**。
  PianoRoll では CSS の width/height を属性値と一致させ、親に `align-items: flex-start` を付けている。
  ここが崩れると描画とクリック座標がずれる

## 動作確認

```bash
npm run typecheck                                   # 型
npm run build                                       # 型 + 本番ビルド
node cli/render.mjs presets/ -d out/ --normalize    # 全プリセットを書き出し
```

音を変えたときは、`presets/*.json` を一括生成して `peak` / `rms` / `zcr` と長さを見る。
`[CLIPPED]` が出たら音量設計が壊れている。

同じ JSON からは必ず同じ波形が出る（ノイズも決定的）ので、リグレッションはハッシュで見られる。

```bash
node cli/render.mjs presets/bomb.json -o out/a.wav && md5sum out/a.wav
```

**ただし自分では音を聴けない。数値は「潰れた・小さい・高域寄り」しか判定できず、
音色や余韻の良し悪しは人が聴くしかない。** 音に関わる変更は必ず聴いてもらうこと。

## 積み残し / 今後やるなら

- ESLint が無い（v1 の設定は react-scripts 依存で機能していなかったため削除した）
- テストが無い。`noteToFreq` / `timeToStep` / `normalizePreset` あたりは純粋関数なので入れやすい
- ピアノロールはノートの移動ができない（置き直しが必要）
- WAV は 16bit モノラル 44.1kHz 固定
