# 設計メモ

次に手を入れるときのための記録。**特に「音の再現のために意図的にそうしている」項目は、知らずに直すと既存のSEが全部変わる。**

## 全体構造

```
src/core/engine.js    音源。UI と CLI の唯一の実装。素の Web Audio のみ、外部依存なし
src/core/engine.d.ts  上の型定義（実装は .js、TS から使うため手書き）
src/core/wav.js       WAVエンコード・末尾トリム・正規化・波形統計
src/audio/player.ts   ブラウザ再生とオフラインレンダリング（engine を呼ぶだけ）
src/store.ts          状態（zustand）、undo/redo、localStorage
src/App.tsx           画面の組み立てとプリセット入出力
src/PianoRoll.tsx     C2〜C7 × 32ステップのグリッド、再生カーソル
src/presetFile.ts     プリセットJSONの解析・検証・マージ
src/randomize.ts      カテゴリ別のランダム生成（UIのサンプルボタン）
src/ui/styles.ts      インラインスタイル定義
src/index.css         body の地色、フォント継承、hover
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

## 画面と操作

```
SE-COMPOSER        [WAV] [プリセット選択▼] [名前] [SAVE] [DEL] [データ▼]
──────────────── ピアノロール ────────────────
       [PLAY] [↶][↷][🗑]  [波形▼] [BPM]
  [laser][coin][jump][powerup][damage][bomb][random][reset]
──────────────── パラメータ4セクション ────────────────
```

上段はファイルとプリセットの管理、ピアノロールから下は音を作る操作、という分け方。
`データ▼` は自前のドロップダウン（`<option>` にアイコンやファイル入力を置けないため
`<select>` は使えない）で、JSON の書き出し・読み込み・マージをまとめている。

- **再生カーソル**は `requestAnimationFrame` から DOM の `transform` を直接書き換える。
  毎フレーム React の state を更新すると再描画が走るため。位置は `AudioContext.currentTime`
  基準で、`setTimeout` ではなくオーディオ時計に同期する
- カーソルは **`DELAY_TIME` 分だけ引いた位置**を指す。原音もディレイラインを通る構成なので
  譜面時刻のまま走らせるとノートの頭で音が鳴っていない。DAW のプラグイン遅延補償にあたる
- `reset` はパラメータだけを初期値に戻し、ノートには触らない（ノート削除はゴミ箱アイコン）
- プリセット選択時はトーストを出さない。手元のリストを切り替えただけで、音が鳴ることが結果になる
- **JSON 読み込みでは自動再生しない**。ファイルを開いただけで鳴るのは押しつけがましいため。
  `applySnapshot` の第3引数で再生の有無を渡す
- 試聴のきっかけは「スライダーを離す」「数値欄で Enter」「PLAY」「Space」。
  **数値欄の blur では鳴らさない**。blur で鳴らすと、PLAY ボタンを押した瞬間の blur が
  先に再生を始め、続くクリックが STOP と解釈されて鳴らなくなる

## プリセットファイルの扱い

解析・検証・マージは `src/presetFile.ts` に集約している。UI のエクスポート形式
（`{current, history}`）、プリセットの配列、CLI が読む単体プリセット（`{name, params, notes}`）、
`current` だけのファイルを受け付ける。

- **`looksLikePreset` による検証は必須**。`normalizePreset` は何を渡しても既定値で埋めた結果を
  返すので、これを通さないと無関係な JSON から「デフォルト値だけのプリセット」が黙って生まれ、
  localStorage に残る。`params` が実在するパラメータ名を1つ以上持つことを条件にしている
- **「リスト読み込み」は件数によらず必ずリストを置き換える**。かつて「1件なら現在値として
  開くだけ」にしていたが、名前どおりに動かないため一覧が更新されないように見えた
- **「リストに追加」は末尾に足し、同名は `名前 (2)` にリネームする**。上書きにすると件数が
  期待どおり増えず、元データも失われる
- リストに入る件数が 0 のファイル（`current` だけ）では、リストを消さないよう触らない

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
- **`<button>` はフォントを継承しない**（`<label>` はする）。同じメニューに両方を並べると
  書体が食い違うので、`index.css` で `font-family: inherit` を当てている
- **canvas には CSS の `:hover` が効かない**。ノートのホバーは `mousemove` で対象を判定し、
  描画時に `globalAlpha` を落として表現している（ボタン類の hover と同じ 0.75）

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
- テストが無い。`noteToFreq` / `timeToStep` / `normalizePreset` / `parsePresetFile` /
  `mergePresets` あたりは純粋関数なので入れやすい。実際そこにバグが出た
- ピアノロールはノートの移動ができない（置き直しが必要）
- WAV は 16bit モノラル 44.1kHz 固定
- CLI はリスト形式のJSONを渡しても `current` しか鳴らせない。`-d` で中の全プリセットを
  個別に書き出せると、UIのバックアップから一括生成ができる
- 原音をディレイに通さない（dry を戻す）選択肢は保留中。音は素直になり遅延も消えるが、
  既存プリセットの聞こえ方が変わる
