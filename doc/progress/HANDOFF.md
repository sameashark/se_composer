# HANDOFF

最終更新: 2026-09-13

## 状態

v2 として公開済み。動作は安定していて、既知の不具合は無い。

- GUI: https://sameashark.github.io/se_composer/ （GitHub Pages / Actions で自動デプロイ）
- Vercel でも配信中（`vite.config.ts` が `GITHUB_PAGES` 環境変数で base を切り替える）
- Claude Code からは `~/.claude/skills/se-compose/` 経由で全プロジェクトから使える

## 触る前に読むもの

- `doc/architecture.md` — **必読**。v1 の音を再現するために意図的にそうしている挙動
  （エンベロープの指数接近、ディレイ 0.25秒固定、detune の共有、音量補正）が表にしてある。
  知らずに直すと既存のSEが全部変わる
- `doc/usage.md` — 指示の出し方・プロジェクトへの組み込み方

## 次にやるなら（優先度順）

1. **テスト導入**。`parsePresetFile` / `mergePresets` は純粋関数なのに実際にバグが出た
   （1件のリストを読むと一覧が更新されない）。`noteToFreq` / `timeToStep` / `normalizePreset` も対象
2. **CLI のリスト形式対応**。今は `{current, history}` を渡しても `current` しか鳴らせない。
   `-d` で中の全プリセットを個別WAVに書き出せると、UIのバックアップから一括生成ができる
3. ピアノロールのノート移動（今は消して置き直すしかない）
4. ESLint（v1 の設定は react-scripts 依存で機能していなかったため削除済み）

## 未決

- **原音をディレイに通さない（dry を戻す）か**。音は素直になり 0.25秒の遅延も消えるが、
  既存プリセットの聞こえ方が変わる。ユーザーの判断待ちで保留中
- 音色や余韻の良し悪しは数値で判定できない。**音に関わる変更は必ず聴いてもらうこと**

## 動作確認

```bash
npm run typecheck
npm run build
node cli/render.mjs presets/ -d out/ --normalize   # 全プリセット書き出し
npm run dev                                         # http://localhost:3000
```
