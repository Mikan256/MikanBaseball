import { battingRating, fieldingAtPosition, pitchingRating, starRating } from './abilities.js'
import { BATTED_BALL_LOCATIONS, involvedFielders } from './positions.js'
import { BASE_COUNT, BALLS_FOR_WALK, STRIKES_FOR_OUT } from './constants.js'
import { advanceOnWalk, advanceRunners } from './runners.js'
import { battingOrder } from './roster.js'

/**
 * 能力値から試合結果を解く部分。
 * 1 球ずつ操作するのではなく、1 打席の結果をまとめて 1 回で解く。
 * これにより 1 試合を数百回の計算で再現できる。
 */

/** 打席の結果の種類 */
export const OUTCOME = {
  STRIKEOUT: 'strikeout',
  WALK: 'walk',
  SINGLE: 'single',
  DOUBLE: 'double',
  TRIPLE: 'triple',
  HOMERUN: 'homerun',
  GROUNDOUT: 'groundout',
  FLYOUT: 'flyout',
  LINEOUT: 'lineout',
  INFIELD_HIT: 'infieldhit',
}

export const OUTCOME_LABELS = {
  [OUTCOME.STRIKEOUT]: '三振',
  [OUTCOME.WALK]: '四球',
  [OUTCOME.SINGLE]: '一塁安打',
  [OUTCOME.DOUBLE]: '二塁安打',
  [OUTCOME.TRIPLE]: '三塁安打',
  [OUTCOME.HOMERUN]: 'ホームラン',
  [OUTCOME.GROUNDOUT]: 'ゴロアウト',
  [OUTCOME.FLYOUT]: 'フライアウト',
  [OUTCOME.LINEOUT]: 'ライナーアウト',
  [OUTCOME.INFIELD_HIT]: '内野安打',
}

/**
 * 1 球あたりの基準確率。
 * 実際の分布（高校野球の目安）に合わせるように、スクリプトで追い込んだ値。
 * 打球確率は「1 から他を引いた余り」なので、この 3 つを変えると打球率が自動で動く。
 */
const BALL_RATE = 0.36
const STRIKE_RATE = 0.13
const FOUL_RATE = 0.28

/** 打球のうち安打になる割合の基準値。指数で上下する。 */
const HIT_RATE = 0.36

/** アウトになる結果の一覧 */
export const OUT_TYPES = [OUTCOME.STRIKEOUT, OUTCOME.GROUNDOUT, OUTCOME.FLYOUT, OUTCOME.LINEOUT]

export const isOut = (outcome) => OUT_TYPES.includes(outcome)

/**
 * 1 球の結果を解く。
 *
 * カウントによって球の出し方が変わるので、カウントを引数として受け取る。
 * - 2 ストライクなら投手は勝負を急ぎ、ボールが出やすくなる
 * - 3 ボールなら打者が絞ってくるためストライクが減る
 *
 * @returns {{outcome: string, location?: string, text: string}}
 */
export function resolvePitch({ batter, pitcher, fielders, rng, count = { balls: 0, strikes: 0 } }) {
  const { balls, strikes } = count
  const twoStrikes = strikes >= 2
  const threeBalls = balls >= 3

  // 指数: 打者有利ならプラス、投手有利ならマイナス。-1 〜 1 に収める。
  const edge = clamp((battingRating(batter) - pitchingRating(pitcher)) / 100, -1, 1)

  // 投手の球質（球速・変化球の平均）
  const stuff = (pitcher.abilities.velocity + pitcher.abilities.breaking) / 2

  // 各結果の基準確率。カウントによる補正を加えたあと、残りを打球に割り当てる。
  // 実測値（高校野球の目安）: 1 打席 3.3 球 / 安打率 26% / 三振率 19% / 四球率 8%
  const pBall = clamp(
    BALL_RATE +
      (batter.abilities.approach - pitcher.abilities.control) / 500 -
      edge * 0.03 +
      (twoStrikes ? 0.1 : 0) -
      (threeBalls ? 0.1 : 0),
    0.05,
    0.7,
  )

  const pStrike = clamp(
    STRIKE_RATE +
      (stuff - batter.abilities.contact) / 400 +
      (twoStrikes ? 0.08 : 0) -
      (threeBalls ? 0.08 : 0),
    0.02,
    0.6,
  )

  const pFoul = clamp(FOUL_RATE + (batter.abilities.contact - stuff) / 500, 0.05, 0.4)

  // 打球は残りの確率。指数が高いほど打てる
  const pContact = clamp(1 - pBall - pStrike - pFoul, 0.05, 0.8)

  const roll = rng.next() * (pBall + pStrike + pFoul + pContact)

  if (roll < pBall) return { outcome: 'ball', text: 'ボール' }
  if (roll < pBall + pStrike) return { outcome: 'strike', text: 'ストライク' }
  if (roll < pBall + pStrike + pFoul) return { outcome: 'foul', text: 'ファウル' }
  return resolveBattedBall({ batter, fielders, rng, edge })
}

/**
 * 打席 1 回を通しで解く。4 球なら四球、3 ストライクなら三振で終わる。
 *
 * @returns {{outcome: string, text: string, pitches: number, location?: string, error?: boolean}}
 */
export function resolvePlateAppearance({ batter, pitcher, fielders, rng }) {
  let balls = 0
  let strikes = 0
  let pitches = 0

  // 1 打席が際限なく続くことはないはずだが、防御のため上限を設ける
  const MAX_PITCHES = 30

  while (pitches < MAX_PITCHES) {
    pitches += 1
    const result = resolvePitch({ batter, pitcher, fielders, rng, count: { balls, strikes } })

    if (result.outcome === 'ball') {
      balls += 1
      if (balls >= BALLS_FOR_WALK) {
        return { ...result, outcome: OUTCOME.WALK, text: OUTCOME_LABELS[OUTCOME.WALK], pitches }
      }
      continue
    }

    if (result.outcome === 'strike') {
      strikes += 1
      if (strikes >= STRIKES_FOR_OUT) {
        return { outcome: OUTCOME.STRIKEOUT, text: OUTCOME_LABELS[OUTCOME.STRIKEOUT], pitches }
      }
      continue
    }

    if (result.outcome === 'foul') {
      // 2 ストライクならファウルではカウントが変わらない
      if (strikes < 2) strikes += 1
      continue
    }

    // 打球したら打席は終了
    return { ...result, text: describeOutcome(result.outcome, result.text), pitches }
  }

  // 上限に達したら三振として扱う（実際にはまず起きない）
  return { outcome: OUTCOME.STRIKEOUT, text: OUTCOME_LABELS[OUTCOME.STRIKEOUT], pitches }
}

/**
 * 打球が飛んだ後に安打かアウトかを決める。
 * liveGame からも使えるよう、打球の質（powerAdjust / hitAdjust）を引数で受け取る。
 */
export function resolveBattedBall({
  batter,
  fielders,
  rng,
  edge = 0,
  powerAdjust = 0,
  hitAdjust = 0,
}) {
  const location = rng.weighted(BATTED_BALL_LOCATIONS, (entry) => entry.weight).id
  const involved = involvedFielders(location)

  // 守備に絡む選手のうち最も弱い人の守備力を基準にミスを判定
  const weakest = involved
    .map((positionId) => {
      const player = fielders[positionId]
      return player ? fieldingAtPosition(player, positionId) : 50
    })
    .reduce((min, value) => Math.min(min, value), 100)

  const errorChance = clamp((70 - weakest) / 320, 0, 0.12)

  if (rng.next() < errorChance) {
    return { outcome: OUTCOME.SINGLE, text: '守備エラー', location }
  }

  const hitChance = clamp(HIT_RATE + edge * 0.3 + hitAdjust, 0.05, 0.85)
  if (rng.next() >= hitChance) {
    // アウト判定は 1 回だけ乱数を引く（二重に引くと分布がずれる）
    const outcome = pickOut(location, rng)
    return { outcome, text: OUTCOME_LABELS[outcome], location }
  }

  return { outcome: pickHit(batter, rng, powerAdjust), text: '', location }
}

/**
 * 安打になったときの打球距離を決める。
 * ホームランは安打の 3% 程度が実測値なので、それに合わせて基準値を下げている。
 */
function pickHit(batter, rng, powerAdjust = 0) {
  const power = clamp(batter.abilities.power + powerAdjust, 1, 100)
  const roll = rng.next()

  const homerunRate = clamp(0.018 + (power - 60) / 700, 0.004, 0.12)
  const tripleRate = clamp(0.06 + (power - 60) / 700, 0.02, 0.18)
  const doubleRate = clamp(0.24 + (power - 60) / 450, 0.08, 0.5)

  if (roll < homerunRate) return OUTCOME.HOMERUN
  if (roll < homerunRate + tripleRate) return OUTCOME.TRIPLE
  if (roll < homerunRate + tripleRate + doubleRate) return OUTCOME.DOUBLE
  return OUTCOME.SINGLE
}

/** アウトになったときの種類。ライナーは飛球の中間。 */
function pickOut(location, rng) {
  const isOutfield = ['LF', 'CF', 'RF', 'gap'].includes(location)

  if (!isOutfield) {
    return rng.next() < 0.65 ? OUTCOME.GROUNDOUT : OUTCOME.LINEOUT
  }
  return rng.next() < 0.85 ? OUTCOME.FLYOUT : OUTCOME.LINEOUT
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/** 守備側の選手を { P: player, '1B': player, ... } の形に集める */
export function buildFielders(team) {
  const fielders = {}
  for (const slot of team.starters) {
    fielders[slot.position] = slot.player
  }
  return fielders
}

/** 結果を日本語の 1 行テキストにする */
export function describeOutcome(outcome, text) {
  if (text) return text
  return OUTCOME_LABELS[outcome] ?? outcome
}

/**
 * 1 試合を通しでシミュレーションする。
 * 投手交代・代打などの戦術は未実装（先発投手が 9 回投げ切る）。
 */
export function simulateGame({ homeTeam, awayTeam, rng }) {
  const state = {
    inning: 1,
    isTopHalf: true,
    outs: 0,
    runners: [null, null, null],
    score: { home: 0, away: 0 },
    linescore: { home: [], away: [] },
    finished: false,
    plays: [],
    pitchersUsed: { home: [], away: [] },
  }

  let batterIndex = 0

  while (!state.finished) {
    const offenseTeam = state.isTopHalf ? awayTeam : homeTeam
    const defenseTeam = state.isTopHalf ? homeTeam : awayTeam
    const order = battingOrder(offenseTeam)
    const batter = order[batterIndex % order.length]
    const pitcher = defenseTeam.starters.find((slot) => slot.position === 'P').player
    const fielders = buildFielders(defenseTeam)
    const scoreKey = state.isTopHalf ? 'away' : 'home'

    const result = resolvePlateAppearance({ batter, pitcher, fielders, rng })

    // resolvePlateAppearance が打席を完結させるので、どの結果でも打席は交代する
    batterIndex += 1
    applyOutcome(state, result, batter, scoreKey)

    state.plays.push({
      inning: state.inning,
      half: state.isTopHalf ? '表' : '裏',
      batter: batter.name,
      outcome: result.outcome,
      text: describeOutcome(result.outcome, result.text),
      pitches: result.pitches,
      score: { ...state.score },
    })

    if (state.outs >= 3) {
      state.outs = 0
      state.runners = [null, null, null]
      batterIndex = 0

      if (state.isTopHalf) {
        state.isTopHalf = false
      } else {
        state.isTopHalf = true
        state.inning += 1
        if (state.inning > 9) state.finished = true
      }
    }
  }

  return state
}

/**
 * 打席の結果を試合状態に適用する。
 * 四球と安打は advanceRunners に任せ、進んだ結果の 1 塁に打者を置く。
 * アウト系はアウトを 1 つ増やすだけ（走者はそのまま）。
 */
function applyOutcome(state, result, batter, scoreKey) {
  if (result.outcome === OUTCOME.WALK) {
    const { runners, scored } = advanceOnWalk(state.runners)
    runners[0] = batter
    state.runners = runners
    addScore(state, scoreKey, scored)
    return
  }

  const bases = basesFor(result.outcome)

  if (bases === 0) {
    state.outs += 1
    return
  }

  const { runners, scored } = advanceRunners(state.runners, bases)

  if (bases > BASE_COUNT) {
    // ホームランは打者を含めて全走者が得点し、塁は空く
    state.runners = [null, null, null]
    addScore(state, scoreKey, scored + 1)
    return
  }

  runners[0] = batter
  state.runners = runners
  addScore(state, scoreKey, scored)
}

/** 安打の種類から進塁数を求める。ホームランは 4 として扱う。 */
export function basesFor(outcome) {
  switch (outcome) {
    case OUTCOME.SINGLE:
      return 1
    case OUTCOME.DOUBLE:
      return 2
    case OUTCOME.TRIPLE:
      return 3
    case OUTCOME.HOMERUN:
      return 4
    default:
      return 0
  }
}

function addScore(state, scoreKey, runs) {
  if (runs <= 0) return
  state.score[scoreKey] += runs
  state.linescore[scoreKey][state.inning - 1] =
    (state.linescore[scoreKey][state.inning - 1] ?? 0) + runs
}

/** 試合結果の要点をまとめる（UI 表示用） */
export function gameSummary(state) {
  const total = state.score.home + state.score.away
  const margin = Math.abs(state.score.home - state.score.away)
  return { total, margin, oneRunGame: total > 0 && margin === 1 }
}

/** 選手を星 5 個の評価で表す（デバッグ・テスト用） */
export function starLabel(player, positionId) {
  const rating = positionId ? fieldingAtPosition(player, positionId) : battingRating(player)
  return `${'★'.repeat(starRating(rating))}${'☆'.repeat(5 - starRating(rating))}`
}
