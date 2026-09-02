# Claude Code から音を作る

`~/.claude/skills/se-compose/` にスキルを置いてあるので、**どのプロジェクトからでも**
普通に頼めば動く。ツール本体（このリポジトリ）のパスはスキル側に書いてある。

## 頼み方

そのまま日本語で言えばよい。スキルが自動的に選ばれる。

```
ジャンプ音を作って
```
```
このゲーム用にSEを一式作りたい。ジャンプ、コイン、ダメージ、ゲームオーバーの4つ
```
```
さっきのレーザー音、もっと短くして高くして
```

**音のイメージは擬音で伝えるのが早い。** 「ピシュン」「ドーン」「シャキーン」「ポワワ〜ン」
のような言い方は、スキルに入っているパラメータ辞典（音色・時間・ピッチ変化・揺らし・音質）に
そのまま対応づけられる。

調整も言葉で通る。

| 言い方 | 効くパラメータ |
|---|---|
| 短く / 長く | `decay` `release` `width` |
| 高く / 低く | `notes[].pitch` |
| 明るく / こもらせて | `filterCutoff` `oscillatorType` |
| 金属的に / 硬く | `filterEnvAmount` |
| レトロに / ファミコンぽく | `square` + `repeatSpeed` |
| 派手に / 迫力を | `filterEnvAmount` `delayFeedback` `noise` |
| 揺らして / 不穏に | `lfoDepth` `lfoTarget` |

## Claude は音を聴けない

生成した WAV は `--play` で鳴らせるが、**判断できるのは人間だけ**。
Claude 側が見ているのは `peak` / `rms` / `zcr`（高域の目安）/ 長さといった数値で、
「潰れている・小さい・高すぎる」程度しか分からない。

なので進め方は次の往復になる。

1. 用途を伝える → プリセットJSONが作られ、生成・再生される
2. 聴いて感想を返す（「もっと短く」「余韻が欲しい」「重すぎる」）
3. 1〜2個だけ数値が変わって鳴り直す

一度に大量のバリエーションを作らせるより、1音ずつ詰めるほうが速い。
SEを一式頼むときも、代表の1音を決めてから残りに展開したほうが手戻りが少ない。

## プロジェクトでの置き場所

音の実体はパラメータJSON。**JSONが資産で、WAVは出力物**。

```
your-game/
  sounds/          プリセットJSON（コミットする）
    jump.json
    coin.json
    enemy-hit.json
  public/se/       生成されたWAV（プロジェクトの流儀に合わせる）
```

一括生成はこれだけ。

```bash
node C:/Users/tkosh/claude-project/se-composer/cli/render.mjs sounds/ -d public/se/ --normalize
```

`--normalize` を付けると全部のピークが -1dB に揃うので、SE同士の音量差が気にならなくなる。

調整するときは JSON を直して同じコマンドを再実行する。**WAV を直接編集しない。**
同じ JSON からは必ず同じ波形が出るので、いつでも作り直せる。

出力先は既存の配置に合わせること（`public/se/`、`assets/audio/`、`Assets/Sounds/`、
`static/sfx/` など）。「SEを組み込んで」と頼めば、再生側のコードもプロジェクトの
既存の仕組みに合わせて書かれる。

## GUI で詰めたいとき

言葉で詰めるより耳とスライダーのほうが速い場面もある。

```bash
cd C:/Users/tkosh/claude-project/se-composer
npm run dev
```

CLI と同じ音源コアなので音は一致する。

- CLI で作った JSON は「JSON読み込み」でそのまま開ける
- 詰めたら **`JSON` ボタン**で単体プリセットとして保存し、`sounds/` に戻す
  （隣の「JSON書き出し」は保存済みプリセット全部入りの形式で、CLI に渡すには不向き）

GitHub Pages でも同じ画面が使える（ローカルに `npm run dev` する必要がない）。

## よく使うコマンド

```bash
SE=C:/Users/tkosh/claude-project/se-composer

# 1音だけ試して鳴らす
node $SE/cli/render.mjs sounds/jump.json -o out/jump.wav --play

# ディレクトリごと一括生成して音量を揃える
node $SE/cli/render.mjs sounds/ -d public/se/ --normalize

# ファイルを作らずその場で試す
node $SE/cli/render.mjs '{"params":{"oscillatorType":"square","pitchAmount":24},"notes":[{"pitch":"C5","width":1}]}' -o out/tmp.wav --play

# 数値だけ見る
node $SE/cli/render.mjs sounds/jump.json --json
```

お手本は `$SE/presets/` にある（laser / bomb / coin / powerup / damage / jump）。
