import {
  BASE_COUNT,
  BALLS_FOR_WALK,
  INNINGS,
  OUTS_PER_HALF_INNING,
  STRIKES_FOR_OUT,
} from './constants.js'

/**
 * 試合の状態管理。
 *
 * 方針:
 * - ゲームロジック層は DOM に一切依存しない（だから Node 上で単体テストできる）。
 * - 状態は「その場で変更して」返す。コピーを返さないので UI 層は state を直接読んで再描画できる。
 */

/** 新しい試合状態を作る */
export function createInitialState({ home, away, rngSeed = 1 } = {}) {
  return {
    home: home ?? { name: 'ホームチーム', color: '#2f9e6b', lineup: [] },
    away: away ?? { name: 'アウェイチーム', color: '#d9534f', lineup: [] },
    rngSeed,
    inning: 1,
    isTopHalf: true,
    outs: 0,
    balls: 0,
    strikes: 0,
    /** [一塁, 二塁, 三塁] の走者。无人なら null */
    runners: [null, null, null],
    score: { home: 0, away: 0 },
    /** 回ごとの得点（添字 0 が 1 回） */
    linescore: { home: [], away: [] },
    /** 打席番号 */
    batterIndex: 0,
    finished: false,
    log: [],
  }
}

/** 攻撃している側のキー ('home' | 'away') */
export const offenseKey = (state) => (state.isTopHalf ? 'away' : 'home')

/** 守備している側のキー */
export const defenseKey = (state) => (state.isTopHalf ? 'home' : 'away')

/** 攻撃している側のチーム名 */
export const offenseName = (state) => state[offenseKey(state)].name

/** 現在の打者 */
export function currentBatter(state) {
  const lineup = state[offenseKey(state)].lineup
  if (lineup.length === 0) return { name: '打者', number: 0, power: 0.5 }
  return lineup[state.batterIndex % lineup.length]
}

/**
 * 走者を bases 塁進める純粋関数。
 * 本塁を超えた走者の人数を scored として返す。
 */
export function advanceRunners(runners, bases) {
  const next = [null, null, null]
  let scored = 0

  for (let index = 0; index < BASE_COUNT; index += 1) {
    const runner = runners[index]
    if (!runner) continue
    const destination = index + 1 + bases
    if (destination > BASE_COUNT) scored += 1
    else next[destination - 1] = runner
  }

  return { runners: next, scored }
}

/** 内部用: 得点を加算して回別スコアに記録する */
function addRuns(state, key, runs) {
  if (runs === 0) return
  state.score[key] += runs
  state.linescore[key][state.inning - 1] = (state.linescore[key][state.inning - 1] ?? 0) + runs
}

/** ヒットなど: 走者を進げ、打者を一塁に置き、得点を加算する */
export function applyHit(state, bases) {
  const { runners, scored } = advanceRunners(state.runners, bases)
  const batter = currentBatter(state)
  runners[0] = batter

  state.runners = runners
  addRuns(state, offenseKey(state), scored)
  state.balls = 0
  state.strikes = 0
  nextBatter(state)

  return { scored, batter, bases }
}

/** 四球: 打者在審なら走者を 1 塁ずつ進める */
export function applyWalk(state) {
  const { runners, scored } = advanceRunners(state.runners, 1)
  runners[0] = currentBatter(state)

  state.runners = runners
  addRuns(state, offenseKey(state), scored)
  state.balls = 0
  state.strikes = 0

  return { scored }
}

/** アウト 1 つ。3 OUT になったら表裏を自動的に交代させる */
export function applyOut(state) {
  state.outs += 1
  state.balls = 0
  state.strikes = 0
  nextBatter(state)

  if (isHalfInningOver(state)) closeHalfInning(state)

  return state.outs
}

/**  打席首歌turn を送る（アウト・ヒット・四球の共通処理） */
function nextBatter(state) {
  state.batterIndex += 1
}

/** ボール 1 つ。四球に達したら自動処理する */
export function applyBall(state) {
  state.balls += 1
  state.strikes = 0
  if (state.balls >= BALLS_FOR_WALK) {
    const { scored } = applyWalk(state)
    nextBatter(state)
    return { walk: true, scored }
  }
  return { walk: false, scored: 0 }
}

/** ストライク 1 つ。三振に達したら自動処理する */
export function applyStrike(state) {
  state.strikes += 1
  state.balls = 0
  if (state.strikes >= STRIKES_FOR_OUT) {
    applyOut(state)
    return { strikeout: true }
  }
  return { strikeout: false }
}

/** ファウル: 2 ストライク（涙目）のときは三振にならない */
export function applyFoul(state) {
  if (state.strikes < STRIKES_FOR_OUT - 1) state.strikes += 1
  state.balls = 0
  return state.strikes
}

/** 3 OUT になったか */
export const isHalfInningOver = (state) => state.outs >= OUTS_PER_HALF_INNING

/**
 * 表裏を交代させる。9 回裏まで終われば試合終了。
 * 延長戦（タイブレーク）は未実装。
 */
export function closeHalfInning(state) {
  state.outs = 0
  state.balls = 0
  state.strikes = 0
  state.runners = [null, null, null]
  state.batterIndex = 0

  if (state.isTopHalf) {
    state.isTopHalf = false
    return
  }

  state.isTopHalf = true
  state.inning += 1

  if (state.inning > INNINGS) state.finished = true
}

/** 試合終了判定 */
export const isGameOver = (state) => state.finished

/** 「1回 表」「3回 裏」形式の見出し */
export const inningLabel = (state) => `${state.inning}回 ${state.isTopHalf ? '表' : '裏'}`

/** 勝利した側のキーを返す。同点なら null */
export function winnerKey(state) {
  if (!isGameOver(state)) return null
  if (state.score.home > state.score.away) return 'home'
  if (state.score.away > state.score.home) return 'away'
  return null
}

/** ログに 1 行追加する */
export function addLog(state, text) {
  state.log.unshift({ inning: inningLabel(state), text })
  if (state.log.length > 100) state.log.length = 100
}
