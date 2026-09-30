# AGENTS.md

このリポジトリで作業する AI / 人間開発者向けの指針。

## プロジェクト概要

ブラウザで遊べる野球ゲーム。**ビルド不要**の素の JavaScript（ES Modules）で動く。
UI 言語は日本語。コード内のコメントも日本語。

## 環境

- Node.js 20 以上、npm
- Playwright のブラウザは `npx playwright install chromium` で取得済み
- `npx playwright install --with-deps` は sudo を要求するので使わない（この環境では失敗する）

## 共通のコマンド

```bash
npm run dev         # http://127.0.0.1:4173/ で開発サーバー
npm test            # ユニットテスト（Vitest）
npm run test:e2e    # E2E テスト（Playwright）
npm run lint        # ESLint
npm run format      # Prettier で整形
npm run verify      # 上記すべてをまとめて実行（コミット前に必ず通す）
```

`file://` では ES Modules が読み込めないため、`index.html` を直接開いても動かない。必ず `npm run dev` で HTTP 経由で確認する。

## コード規約

- **フォーマットは Prettier に任せる**。シングルクォート、セミコロンなし、2 スペース、printWidth 100。
- `import` の拡張子 `.js` を省略しない（ブラウザが解決できない）。
- 実行時依存（`dependencies`）は増やさない方針。すべて devDependencies。
- `src/game/` は **DOM に依存させない**。ブラウザ API を持ち込まない。
- 乱数は必ずシード付きにする。同じシードなら同じ結果になることがテストの前提。

## 構成

- `src/main.js` — 起動とイベント配線。DOM を触るのはここが中心。
- `src/ui/render.js` — 状態を HTML 文字列に変換する。状態は単一の情報源なので全再描画でよい。
- `src/game/gameState.js` — 試合状態の生成、表裏交代、走者進塁。純粋ロジック。
- `src/game/pitch.js` — 投球結果の確率テーブルと解決。
- `src/game/rng.js` — mulberry32 ベースの決定論的な乱数。
- `src/data/` — 選手・チームのデータ。

## 状態管理の約束

`gameState.js` の関数は **state をその場で変更して** 戻り値を返す（コピーを返さない）。
UI 層は state を直接読んで再描画する。`advanceRunners` だけは副作用を避けるため純粋関数にしてある。

## テストの書き方

### ユニットテスト（`tests/unit/`）

Node 上で動くロジックだけをテストする。DOM は使わない。

```js
import { describe, expect, it } from 'vitest'
```

Vitest の設定で `tests/e2e/` は除外されているので、E2E テストが拾われることはない。

### E2E テスト（`tests/e2e/`）

実ブラウザで操作するテスト。要素は必ず `data-testid` で取得する。

```js
await page.getByTestId('pitch-straight').click()
await expect(page.getByTestId('inning')).toHaveText('1回 表')
```

class 名や表示文言に依存しない。class や文言を変えると落ちるテストにしてはいけない。

### E2E の注意点

- 1 試合は 400〜900 球に達する。1 球ずつ `click()` を待つと数十秒かかるので、試合終了まで流す場合は `page.evaluate` の中でループさせる（`tests/e2e/game.spec.js` の `playUntilGameOver` を参照）。
- 投球結果は乱数で変わるので、テストが結果に依存しないようにする。「表が終わるまで投球する」のではなく「状態がこうなったら終わる」という条件だけを見る。

## 実装済みのゲームルール

- 9 回まで。延長戦（タイブレーク）は**未実装**。
- 1 表 / 1 裏は 3 OUT で交代。交代時に走者とカウントはリセットされる。
- ヒット・四球・アウトのいずれでも打席は交代する。
- ヒットは 1 塁 / 2 塁 / 3 塁 / ホームランの 4 区分。ホームランは「4 塁進む」として扱ってる。
- ホームラン以外は走者が進塁し、本塁を超えた人数だけ得点になる。

## 既知の制約・次の一手

以下は**まだ実装していない**。着手する前に README とここを更新すること。

- 選手の能力値と守備位置
- 編成（9 人 + 投手など、野球の人数に沿ったメンバー登録）
- 選手のシーズン通算（打席 / 投球統計）
- 代打 / 代走 / 投手交代
