# みかん野球 (MikanBaseball)

ブラウザで遊べる野球ゲーム。ビルド不要の素の JavaScript（ES Modules）で動く。

## 必要な環境

- Node.js 20 以上
- npm

## セットアップ

```bash
npm install
npx playwright install chromium
```

`npx playwright install --with-deps` が sudo を要求する場合は、`--with-deps` を付けずに実行してブラウザ本体だけを取得してください。

## コマンド

| コマンド             | 内容                                         |
| -------------------- | -------------------------------------------- |
| `npm run dev`        | 開発サーバー（http://127.0.0.1:4173/）       |
| `npm test`           | ユニットテスト（Vitest）                     |
| `npm run test:watch` | ユニットテストを監視モードで                 |
| `npm run test:e2e`   | E2E テスト（Playwright）                     |
| `npm run test:all`   | ユニット + E2E                               |
| `npm run lint`       | ESLint                                       |
| `npm run format`     | Prettier で整形                              |
| `npm run verify`     | lint + フォーマットチェック + ユニット + E2E |

開発サーバーは **HTTP で開く必要があります**。`file://` ではブラウザが ES Modules を読み込めないため、`index.html` を直接開くことはできません。

## ディレクトリ構成

```
index.html            エントリーポイント
src/
  main.js             起動とイベント配線（DOM を触るのはここ）
  game/
    constants.js      試合ルール上の定数
    gameState.js      試合状態の生成と表裏交代（DOM 非依存）
    pitch.js          投球の解決と確率テーブル（DOM 非依存）
    rng.js            再現可能な擬似乱数
  ui/render.js        状態から HTML を生成
  data/teams.js       初期チームと選手データ
  styles/main.css     スタイル
tests/
  unit/               Vitest（Node 上で動くロジックテスト）
  e2e/                Playwright（実ブラウザでの操作テスト）
scripts/serve.js      依存ゼロの静的ファイルサーバ
```

## 設計方針

- **ビルドしない**。実行時依存はゼロで、ブラウザがそのまま ES Modules を実行する。
- **ゲームロジックは DOM に依存しない**。`src/game/` は Node 上で動くので高速にテストできる。
- **乱数は必ずシード付き**。同じシードなら同じ試合結果になるため、テストが安定する。
- **E2E は `data-testid` で要素を探す**。class 名や文言に依存しない。

## 現在のゲーム内容

簡易な試合シミュレーションです。球種（ストレート / カーブ / チェンジ / スライダー）を選び、9 回まで戦います。

- ボール / ストライク / ファウルのカウント管理
- ヒット（1 塁〜ホームラン）と得点計算
- 四球による走者進塁
- 3 OUT での表裏交代、9 回終了時のゲームオーバー
- プレイログの記録

選手の能力値や守備位置からなる編成機能は**未実装**です（次のステップ）。
