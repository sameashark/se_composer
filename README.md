# SE-Composer

効果音（SE）を作るシンセ。**ブラウザUIとCLIが同じ音源コアを共有する**ので、どちらで作っても同じ音が出て、JSONで行き来できる。

**GUI: https://sameashark.github.io/se_composer/**

- 音源コア: [`src/core/engine.js`](src/core/engine.js) — 素の Web Audio API のみ。ブラウザ / Node 両対応、外部ライブラリなし
- CLI: [`cli/render.mjs`](cli/render.mjs) — パラメータJSON → WAV
- UI: React + Vite

ドキュメント: [設計メモ](doc/architecture.md)（次に手を入れるとき用） / [Claude Code から音を作る](doc/usage.md)

## 使い方

### ブラウザ

```bash
npm install
npm run dev
```

ピアノロールにノートを置き、パラメータを動かすと即座に鳴る。`WAV` で書き出し、`SAVE` でブラウザに保存（localStorage）、JSON の入出力で持ち運べる。

### CLI

```bash
# プリセットから生成して再生
node cli/render.mjs presets/laser.json -o out/laser.wav --play

# ディレクトリごと一括生成（音量をピーク -1dB に揃える）
node cli/render.mjs presets/ -d out/se/ --normalize

# JSONを直接渡す
node cli/render.mjs '{"params":{"oscillatorType":"square","pitchAmount":24},"notes":[{"pitch":"C5","width":1}]}' -o out/tmp.wav --play
```

| オプション | 意味 |
|---|---|
| `-o <path>` | 出力先（入力が1つのときだけ）。省略時は `out/<入力名>.wav` |
| `-d <dir>` | 出力ディレクトリ。入力名がそのままファイル名になる |
| `--play` | 生成後に再生（Windows の SoundPlayer）。複数なら順番に鳴らす |
| `--normalize [dB]` | ピークを指定dB（既定 -1）に正規化 |
| `--no-trim` | 末尾の無音を残す（既定はトリムする） |
| `--json` | パラメータと波形統計を JSON で出力 |

入力にはプリセットJSON・それが入ったディレクトリ・インラインJSONを複数並べられる。
出力の `peak` / `rms` / `zcr`（ゼロクロス率）は、音を聴かずに「潰れている / 小さい / 高域寄り」を判断するための指標。

同じJSONからは必ず同じ波形が出る（ノイズも固定シードで生成する）。

### 他のプロジェクトで使う

プリセットJSONをプロジェクト側に置き、WAVはそこから生成する。

`sounds/*.json` を資産としてコミットしておけば、WAVは何度でも作り直せる。UIで微調整したものは `JSON` ボタンで単体プリセットとして書き出せるので、そのまま `sounds/` に戻せる。

### Claude Code から

`~/.claude/skills/se-compose/` にスキルを置いてあり、どのプロジェクトからでも「レーザー音を作って」で呼び出せる。言葉 → パラメータの対応表はスキル側に持たせている。

## プリセットJSON

```json
{
  "name": "laser",
  "params": { "oscillatorType": "sawtooth", "pitchAmount": -36 },
  "notes": [{ "time": "0:0:0", "pitch": "C5", "width": 2, "velocity": 0.8 }]
}
```

- `params` は書いたキーだけ上書きされ、残りは既定値
- `time` は `"小節:拍:16分"`、`width` は16分音符いくつ分か
- ブラウザUIのエクスポートJSON（`{ current, history }`）も、単体プリセットも、どちらも読める

`presets/` に laser / bomb / coin / powerup / damage / jump の実例がある。

## パラメータ

| 分類 | パラメータ | 説明 |
|---|---|---|
| 音色 | `oscillatorType` | `sine` `triangle` `square` `sawtooth` `noise` |
| | `detune` | 微妙なうねり（cents） |
| 時間 | `attack` `decay` `sustain` `release` | ADSR（秒 / 0〜1 / 秒） |
| ピッチ | `pitchAmount` | スイープ量（半音）。+で上昇、−で下降 |
| | `pitchTime` | スイープにかかる時間（秒） |
| | `repeatSpeed` | 連打速度(Hz)。0で単発 |
| | `arpAmount` | 連打1回ごとの音程変化（半音） |
| 変調 | `lfoRate` `lfoDepth` `lfoTarget` | 揺れ。`pitch`=ビブラート / `filter`=ワウ |
| 音質 | `filterCutoff` | ローパスの明るさ(Hz) |
| | `filterEnvAmount` | アタック時にフィルタが開く量(cents) |
| | `delayFeedback` | ディレイの送り量兼帰還量 |
| 出力 | `masterVolume` | dB |
| | `bpm` | `width` とディレイ間隔の基準 |

`oscillatorType: "noise"` のとき、ピッチ関係（`pitchAmount` `detune` `arpAmount`、`lfoTarget: "pitch"`）は効かない。

## 構成

```
src/core/engine.js    音源コア（UIとCLIの唯一の実装）
src/core/wav.js       WAVエンコード・トリム・正規化・波形統計
src/audio/player.ts   ブラウザ再生とオフラインレンダリング
src/store.ts          状態（zustand）とundo/redo、localStorage
src/PianoRoll.tsx     C2〜C7 の61鍵 × 32ステップ
src/randomize.ts      カテゴリ別のランダム生成
cli/render.mjs        CLI
presets/*.json        プリセット実例
```

## 開発

```bash
npm run dev        # 開発サーバ (http://localhost:3000)
npm run build      # 型チェック + 本番ビルド → dist/
npm run typecheck  # 型チェックのみ
```

デプロイは Vercel（Vite を自動検出、出力は `dist`）。
