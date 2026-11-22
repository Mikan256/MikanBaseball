# AGENTS.md

このリポジトリで作業する AI / 人間開発者向けの指針。

## プロジェクト概要

ブラウザで遊べる野球ゲーム。**ビルド不要**の素の JavaScript（ES Modules）で動く。
UI 言語は日本語。コード内のコメントも日本語。

自分でホーム・アウェイ両チームの名前・選手の能力値・打順・守備位置を決めてチームを組み、疑似3Dのフィールドで 9 回制の試合を戦う。
投球はコース選択＋パワーメーター、打撃はカーソル＋タイミングで操作する。
1人プレイ（アウェイは CPU）、2人プレイ（両チームを交互に操作）、Flaxia Arcadeのオンライン対戦を選べる。
編成データは JSON 文字列（およびファイル）で保存・復元でき、試合は localStorage に自動保存される。
自動進行用に 1 打席単位のシミュレーションも残している。

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

- `src/main.js` — 起動、画面遷移（タイトル / 編成 / 試合 / 結果）、イベント配線。DOM を触るのはここが中心。
- `src/ui/teamScreen.js` — 編成画面。ホーム／アウェイのタブ、選手カード、能力値エディタ、データ入出力の HTML 生成。
- `src/ui/gameScreen.js` — 試合画面。スコアボード、投球メーター、打撃カーソル・タイミング、1人／2人プレイの手番表示。
- `src/ui/matchView.js` — 疑似3Dフィールドの Canvas 描画と打球アニメーション。
- `src/ui/onlineScreen.js` — Flaxiaオンライン対戦のロビー（ルーム作成／参加、準備、開始）。
- `src/net/flaxiaMultiplayer.js` — FlaxiaマルチプレイSDK連携、ホスト権威の操作同期。
- `src/net/onlineState.js` — オンライン送信用の試合状態の圧縮・復元（64KB制限対策）。
- `src/ui/resultScreen.js` — 結果画面。回別スコアと長打のまとめ。
- `src/ui/rosterOps.js` — 打席順・守備位置・控えの入れ替え。
- `src/game/liveGame.js` — **対話型の試合エンジン**。1 球ずつ解決し、投球・打席のフェーズを管理する。
- `src/game/simulate.js` — 1 打席単位の自動シミュレーションと打球判定の共通処理。
- `src/game/roster.js` — 選手・チームのモデル、編成検証、能力値とチーム名の更新。
- `src/game/teamCode.js` — チーム／対戦データの JSON 文字列化・復元と入力検証。
- `src/game/camera.js` — 疑似3Dカメラと透視投影（DOM 非依存）。
- `src/game/field.js` — フィールド座標、守備位置、打球方向の定義（DOM 非依存）。
- `src/game/abilities.js` — 能力値の定義、総合評価、守備適性の計算。
- `src/game/positions.js` — 守備位置、打球位置、守備関与の定義。
- `src/game/runners.js` — 安打・四球の進塁（純粋関数）。
- `src/game/rng.js` — mulberry32 ベースの決定論的な乱数。
- `src/data/rosterFactory.js` — 選手・チームのランダム生成。
- `tests/unit/` — Node 上で動くロジックテスト。
- `tests/e2e/` — 実ブラウザでの操作テスト。

## 状態管理の約束

- `liveGame.js` の関数は **state をその場で変更して** 戻り値を返す（コピーを返さない）。
- UI 層は state を直接読んで再描画する。試合中は毎操作後に `renderGameScreen` で全再描画する。
- `advanceRunners` / `advanceOnWalk` は副作用を避けるため純粋関数にしてある。
- 乱数生成器は state に持たせず、`main.js` が保持して各操作に渡す。テストではシードを固定する。
- 画面全体を再描画するため、開閉状態や入力途中の文字列は `main.js` の変数（`dataOpen`, `importText`, `mode`, `activeSide`）に保持する。
- 編集中のチームは `activeSide`（`home` / `away`）で切り替え、`team` がホーム、`opponent` がアウェイを表す。
- 投球メーター・打撃タイミングは `main.js` の rAF で動かし、DOM のマーカー位置だけを更新する（毎フレーム全再描画しない）。
- 試合中は `SAVE_KEY = 'mikanbaseball-match-v1'` で localStorage に自動保存する。終了時は削除する。
- オンライン対戦はホストが試合エンジンを所有する。ゲストは操作を送り、ホストが適用して `packMatchState` した状態を返す。
- `packMatchState` はチーム情報を除外し、log は40件、plays は120件に絞る。1メッセージ60KB以下を守る。

## チームデータ文字列の約束

- `serializeMatch` は `format: "mikanbaseball-match"` と `version: 1`、`home` / `away` を持つ整形済み JSON を返す。
- `serializeTeam` / `parseTeamCode` は 1 チーム形式（`mikanbaseball-team`）の互換 API として残す。
- `parseMatchCode` は 2 チーム形式なら `{ ok: true, match }`、旧 1 チーム形式なら `{ ok: true, team }`、不正なら `{ ok: false, errors }` を返す。
- 入力値は `createPlayer` 経由で正規化し、能力値は 1〜100、プロフィールは既定値に丸める。
- 守備位置・打席順・人数・投手ルールは `validateLineup` で検証し、不正なら読み込まない。
- 形式やバージョンを変えるときは `teamCode.test.js` と README のサンプルも更新する。

## 対話型エンジンの流れ

1. `createLiveGame({ homeTeam, awayTeam, playerSide, mode, rng })` で state を作る。`mode` は `'solo' | 'two-player'`。
2. 1人プレイでは、プレイヤーが守備なら `phase === 'pitch'`、攻撃なら `phase === 'bat'`。
3. 2人プレイでは常に投手側の `phase === 'pitch'` から始まる。`submitPitch` は球を保留して `phase` を `'bat'` にし、打者側の `submitBatting` で 1 球が確定する。
4. `submitPitch` の `releaseQuality`（0〜1）は投球の制球に、`submitBatting` の `timingQuality` / `cursorMatch` はコンタクト率に影響する。
5. 各操作のあと `refreshPhase` が次のフェーズを決める。3 アウトで攻守交代し、9 回終了時同点なら延長 12 回まで続ける。
6. `currentTurnSide(state)` で現在操作するチーム（`home` / `away`）を取得できる。
7. `autoPlayLiveGame(state, rng)` は両チーム AI で最後まで進める（2人プレイの確認にも使える）。

## Flaxiaオンライン対戦の流れ

1. `OnlineMatch.connect({ roomId })` で `/sdk/game.js` の `FlaxiaGame` を読み込み、`game.multiplayer` でルームを作成または参加する。
2. 両者が `ready(team)` で自分のチームを送信する。
3. ホストが `startMatch()` で `createLiveGame({ mode: 'two-player' })` を作り、チームと状態をゲストへ送る。
4. ゲストは `submitAction()` で操作を送信し、ホストが `applyOnlineAction()` で適用して状態をブロードキャストする。
5. `currentTurnSide(state) === localSide` のときだけ操作できる。待機中は `online-waiting` を表示する。
6. ルーム作成側がホーム、参加側がアウェイ。ルームIDは `client.currentRoomId` / `onRoomState` から表示する。

## テストの書き方

### ユニットテスト（`tests/unit/`）

Node 上で動くロジックだけをテストする。DOM は使わない。

```js
import { describe, expect, it } from 'vitest'
```

Vitest の設定で `tests/e2e/` は除外されているので、E2E テストが拾われることはない。
試合エンジンは「同じシードなら同じ結果」「必ず 9 回以内に終わる」「回別スコアの合計が総得点と一致する」を重視する。

### E2E テスト（`tests/e2e/`）

実ブラウザで操作するテスト。要素は必ず `data-testid` で取得する。

```js
await page.getByTestId('course-high-out').click()
await expect(page.getByTestId('inning')).toHaveText('1回 表')
```

class 名や表示文言に依存しない。class や文言を変えると落ちるテストにしてはいけない。
試合画面には `data-pitch-count` と `data-phase` を付けてあるので、進行確認に使える。
投球結果は乱数で変わるため、「この球は安打になる」のような結果依存のテストは書かない。

### E2E の注意点

- 1 試合は 250〜350 球程度。1 球ずつ `click()` を待つと遅いので、試合終了まで流す場合は「最後まで自動で進める」ボタン（`auto-play`）を使う。
- 表の攻撃を終えて打席まで進めたいときは、コースボタンをループでクリックし、`bat-controls` が出たら止める（`tests/e2e/gameplay.spec.js` を参照）。
- 投球結果は乱数で変わるので、テストが結果に依存しないようにする。
- スマホ対応は `page.setViewportSize({ width: 375, height: 812 })` と `document.documentElement.scrollWidth` で横スクロールの有無を確認する（`tests/e2e/data.spec.js`, `tests/e2e/twoPlayer.spec.js`）。
- 2人プレイは `data-mode` / `data-phase` / `data-turn-side` を見て、投球側→打席側の切り替わりを検証する。
- 能力値はスライダー（`edit-contact`）と数値入力（`edit-number-contact`）の両方から編集でき、値が同期することを確認する。
- 控えの増減は `add-bench` / `bench-remove-N`、ベンチ人数は `bench-count` で確認する。
- 投球は「コースクリック → `release-pitch`」の順で確定する。E2E では `tests/e2e/helpers.js` の `throwPitch` を使う。
- 疑似3Dは `match-canvas` の表示、投球メーターは `pitch-meter-marker`、打撃は `bat-timing-marker` と `cursor-r-c` で確認する。
- 途中保存はページ再読み込み後の `resume-game` と `data-pitch-count` の一致で確認する。
- オンラインは `/sdk/game.js` を直接テストできないため、`onlineMatchFlow.test.js` の FakeClient でチーム交換→開始→投球→打席の同期を検証する。
- オンラインのロビーは `mode-online` / `online-create` / `online-join` / `online-ready` / `online-start` で確認する。ローカルでは利用不可表示になる。
- 文字列の保存・復元は、書き出した値をそのまま貼り付けてラウンドトリップを検証する。

## 実装済みのゲームルール

- 9 回まで。延長戦（タイブレーク）は**未実装**。
- 3 アウトで攻守交代。交代時に走者とカウントはリセットされる。
- 9 回表終了時にホームがリードしていれば 9 回裏は行わない。9 回裏の勝ち越しはサヨナラ。
- ヒット・四球・アウトのいずれでも打席は交代する。
- 四球は押し出しのときだけ走者が進む。
- ヒットは 1 塁 / 2 塁 / 3 塁 / ホームランの 4 区分。
- 投球は 4 球種 × 9 コース。制球力でゾーンに決まるかが変わる。
- 打席は「見送る / ミート / 強振」。ミートは接触率、強振は長打力と空振り率が上がる。
- 守備力・守備位置適性・投手能力が打球結果とエラー率に影響する。
- 能力値エディタで 11 項目の能力、プロフィール、守備適性を編集できる（スライダー／数値入力）。
- 控えは最大 8 人まで追加・削除でき、出場選手との入れ替えもできる。
- 左右打者で内角・外角の表示が入れ替わる（スイッチヒッターは投手の逆打席）。
- 打球方向（レフト前安打・遊撃ゴロなど）を実況テキストに表示する。
- 疑似3Dフィールド（Canvas 2Dの透視投影）で試合を表示する。スタンド、照明、外野フェンス、芝模様、打球軌跡、HOME RUN 演出を含む。
- 投球はコース選択＋パワーメーター、打撃はカーソル＋タイミングで操作する。
- 9 回制。同点なら延長 12 回まで行い、決着しなければ引き分け。
- 試合の途中経過を localStorage に自動保存し、再開できる。
- スマホは横画面推奨。縦画面では横画面を促すオーバーレイを表示する。
- 投球時は投手側、打席時は捕手側の疑似3Dカメラに切り替わる。
- Flaxia ArcadeのマルチプレイAPI（`/sdk/game.js` の `FlaxiaGame` / `game.multiplayer`）でオンライン1対1対戦ができる。ルーム作成／ID参加、準備、ホスト開始に対応。
- チーム名を変更でき、試合画面・結果画面にも反映される。
- ホーム／アウェイの両チームを編集でき、対戦相手も自由に能力値を設定できる。
- 1人プレイと 2人プレイを選択できる。2人プレイでは投手側の配球と打者側の打撃を交互に操作する。
- 編成データを JSON 文字列としてコピー・ファイル保存でき、両チームまとめて復元できる。
- 画面幅 860px / 720px / 560px でレスポンシブに切り替わる。

## 既知の制約・次の一手

以下は**まだ実装していない**。着手する前に README とここを更新すること。

- 投手交代（ブルペン）とスタミナ消費
- 代打・代走・守備交代
- タイブレーク方式の延長戦
- 選手のシーズン通算成績
- 複数チームの保存管理、クラウド同期
- CPU の難易度設定
