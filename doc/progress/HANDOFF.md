# HANDOFF

最終更新: 2026-09-14

## 状態

v2 として公開済み。動作は安定していて、既知の不具合は無い。

- GUI: https://sameashark.github.io/se_composer/ （GitHub Pages / Actions で自動デプロイ）
- Vercel でも配信中（`vite.config.ts` が `GITHUB_PAGES` 環境変数で base を切り替える）
- Claude Code からは `~/.claude/skills/se-compose/` 経由で全プロジェクトから使える

直近でパラメータのロック、ピアノロールのノート選択・移動・コピー、作業内容の自動保存を
追加した。経緯は `doc/progress/20260914.md`。

## 触る前に読むもの

- `doc/architecture.md` §「v1 から引き継いだ挙動」— **必読**。音の再現のために意図的に
  そうしている項目の表。知らずに直すと既存のSEが全部変わる
- `doc/architecture.md` §「ピアノロールの編集操作」— ジェスチャの分岐（`Gesture` 型）と、
  音程を表示行で数えている理由
- `doc/architecture.md` §「事故防止（作業内容の自動保存）」— `pendingCut` が何を解いているか。
  store のノート操作がすべて `pendingCut: []` を書く理由がここにある
- `doc/usage.md` — 指示の出し方・プロジェクトへの組み込み方

## 次にやるなら（優先度順）

1. **テスト導入**。`parsePresetFile` / `mergePresets` は純粋関数なのに実際にバグが出た。
   `noteToFreq` / `timeToStep` / `normalizePreset` / `clampOffset`（PianoRoll）も対象
2. **CLI のリスト形式対応**。今は `{current, history}` を渡しても `current` しか鳴らせない。
   `-d` で中の全プリセットを個別WAVに書き出せると、UIのバックアップから一括生成ができる
3. ESLint（v1 の設定は react-scripts 依存で機能していなかったため削除済み）

## 未決

- **原音をディレイに通さない（dry を戻す）か**。音は素直になり 0.25秒の遅延も消えるが、
  既存プリセットの聞こえ方が変わる。ユーザーの判断待ちで保留中
- 音色や余韻の良し悪しは数値で判定できない。**音に関わる変更は必ず聴いてもらうこと**

## 入れなかったもの（再提案しない）

- ピアノロールの Shift+クリック / Shift+ドラッグでの選択追加、矩形選択中の端オートスクロール、
  タッチでの矩形選択。初版の範囲から外した
- canvas 外のクリックで選択解除。パラメータを触るたびに選択が外れると使いにくい
- undo 履歴の永続化。サイズが嵩む割に `current` と `pendingCut` の保存でほぼ足りる

## 動作確認

```bash
npm run typecheck
npm run build
node cli/render.mjs presets/ -d out/ --normalize   # 全プリセット書き出し
npm run dev                                         # http://localhost:3000
```
