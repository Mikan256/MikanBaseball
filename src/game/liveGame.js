import { battingRating, pitchingRating } from './abilities.js'
import { INNINGS, OUTS_PER_HALF_INNING, BALLS_FOR_WALK, STRIKES_FOR_OUT } from './constants.js'
import { battingOrder, startingPitcher } from './roster.js'
import { advanceOnWalk, advanceRunners } from './runners.js'
import { createRng } from './rng.js'
import { OUTCOME, OUTCOME_LABELS, basesFor, buildFielders, resolveBattedBall } from './simulate.js'

/**
 * 1 球ずつ操作する対話型の試合エンジン。
 *
 * 1人プレイ（solo）ではプレイヤーがホームを担当し、
 * - 表（相手の攻撃）: 球種とコースを選んで投げる（打者は AI）
 * - 裏（自分の攻撃）: 相手投手の球を見て「見送る / ミート / 強振」を選ぶ
 * という操作で 9 回まで戦う。
 *
 * 2人プレイ（two-player）では両チームを人間が操作する。
 * 投手側が球種・コースを選ぶと `phase` が 'bat' になり、
 * 打者側が「見送る / ミート / 強振」を選ぶと 1 球が確定する。
 */

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/** 投球の球種。weights は「その球種らしさ」に使う能力値の比率。 */
export const PITCH_TYPES = [
  {
    id: 'straight',
    label: 'ストレート',
    short: '直',
    weights: { velocity: 0.7, control: 0.3 },
    accuracy: 0.02,
    description: '球速で押し込む基本球。制球しやすい。',
  },
  {
    id: 'slider',
    label: 'スライダー',
    short: 'スラ',
    weights: { breaking: 0.6, velocity: 0.2, control: 0.2 },
    accuracy: -0.03,
    description: '横に曲がる球。空振りを狙えるが制球は微妙。',
  },
  {
    id: 'curve',
    label: 'カーブ',
    short: 'カ',
    weights: { breaking: 0.7, control: 0.3 },
    accuracy: -0.05,
    description: '大きく落ちる球。タイミングを外しやすい。',
  },
  {
    id: 'changeup',
    label: 'チェンジアップ',
    short: 'チ',
    weights: { breaking: 0.5, velocity: 0.2, control: 0.3 },
    accuracy: -0.02,
    description: '打者のタイミングを外す遅球。',
  },
]

export const PITCH_TYPE_BY_ID = Object.fromEntries(PITCH_TYPES.map((type) => [type.id, type]))

const ROWS = [
  { key: 'high', label: '高め' },
  { key: 'middle', label: '真ん中' },
  { key: 'low', label: '低め' },
]

const COLUMNS = [
  { key: 'in', label: '内角' },
  { key: 'center', label: '中央' },
  { key: 'out', label: '外角' },
]

/**
 * 3×3 のコース。中央の行と列がストライクゾーン。
 * 四隅はボール気味で、真ん中は打たれやすい。
 */
export const COURSES = ROWS.flatMap((row, rowIndex) =>
  COLUMNS.map((column, columnIndex) => ({
    id: `${row.key}-${column.key}`,
    row: rowIndex,
    column: columnIndex,
    label: `${row.label}${column.label}`,
    inZone: rowIndex === 1 || columnIndex === 1,
    difficulty:
      rowIndex !== 1 && columnIndex !== 1 ? 0.06 : rowIndex === 1 && columnIndex === 1 ? -0.04 : 0,
  })),
)

export const COURSE_BY_ID = Object.fromEntries(COURSES.map((course) => [course.id, course]))

/** 投球の表示名 */
export function pitchLabel(pitch) {
  return `${pitch.type.label} ${pitch.course.label}`
}

/** 球種とコースから投球オブジェクトを作る。不正な id は例外にする。 */
export function makePitch(typeId, courseId) {
  const type = PITCH_TYPE_BY_ID[typeId]
  const course = COURSE_BY_ID[courseId]
  if (!type) throw new RangeError(`未知の球種です: ${typeId}`)
  if (!course) throw new RangeError(`未知のコースです: ${courseId}`)
  return { type, course }
}

/** 球種の「球質」。投手の該当能力を重み付きで平均する。 */
export function pitchStuff(pitcher, pitch) {
  let total = 0
  let weight = 0
  for (const [key, ratio] of Object.entries(pitch.type.weights)) {
    total += (pitcher.abilities[key] ?? 50) * ratio
    weight += ratio
  }
  return total / weight
}

/** その投球が実際にストライクゾーンへ決まるか */
export function pitchIsStrike({ pitcher, pitch, rng }) {
  const control = clamp(pitcher.abilities.control + pitch.type.accuracy * 100, 1, 100)
  if (pitch.course.inZone) {
    // ゾーン内を狙う。制球が悪いと外れる
    const miss = clamp(0.26 - (control - 50) / 250, 0.04, 0.4)
    return rng.next() >= miss
  }
  // ゾーン外を狙う。制球が悪いと入ってしまう
  const leak = clamp(0.12 - (control - 50) / 300, 0.04, 0.3)
  return rng.next() < leak
}

/**
 * 相手投手（AI）の配球を決める。
 * 能力の高い球種を多めにし、追い込んだらゾーン外、追い込まれたらゾーン内を選ぶ。
 */
export function chooseAiPitch(pitcher, rng, count = { balls: 0, strikes: 0 }) {
  const type = rng.weighted(
    PITCH_TYPES,
    (candidate) =>
      0.4 +
      pitchStuff(pitcher, {
        type: candidate,
        course: COURSES[4],
      }) /
        100,
  )

  const course = rng.weighted(COURSES, (candidate) => {
    let weight = candidate.inZone ? 0.9 : 1.15
    if (candidate.row === 1 && candidate.column === 1) weight = 0.35
    if (count.balls >= 3) weight = candidate.inZone ? 1.6 : 0.25
    if (count.strikes >= 2 && count.balls < 3) weight = candidate.inZone ? 0.7 : 1.4
    return weight
  })

  return { type, course }
}

/** AI 打者の選択。ゾーン内は振り、ゾーン外は選球を重視する。 */
export function chooseAiBattingAction({ batter, pitch, count, rng }) {
  if (!pitch.course.inZone) {
    const chase = clamp(
      0.18 + (batter.abilities.approach - 50) / 300 + (count.strikes >= 2 ? 0.42 : 0),
      0.05,
      0.85,
    )
    if (rng.next() < chase) return rng.next() < 0.25 ? 'power' : 'contact'
    return 'take'
  }

  const swingRate = count.strikes >= 2 ? 0.94 : 0.7
  if (rng.next() < swingRate) return rng.next() < 0.35 ? 'power' : 'contact'
  return 'take'
}

/**
 * 1 球を解決する。打者が「見送る」ならボール / 見逃しストライク、
 * 振れば空振り / ファウル / 打球のいずれかになる。
 *
 * @returns {{kind: 'ball'|'strike'|'foul'|'inplay', text: string, outcome?: string, location?: string}}
 */
export function resolveLivePitch({ batter, pitcher, fielders, pitch, action, rng }) {
  const strike = pitchIsStrike({ pitcher, pitch, rng })

  if (action === 'take') {
    return strike ? { kind: 'strike', text: '見逃しストライク' } : { kind: 'ball', text: 'ボール' }
  }

  const stuff = pitchStuff(pitcher, pitch)
  const swingMod = action === 'contact' ? 0.08 : action === 'power' ? -0.1 : 0
  const contactRate = clamp(
    0.62 +
      (batter.abilities.contact - stuff) / 260 +
      (pitch.course.inZone ? 0.06 : -0.13) -
      pitch.course.difficulty +
      swingMod,
    0.12,
    0.92,
  )

  if (rng.next() >= contactRate) {
    return { kind: 'strike', text: '空振りストライク' }
  }

  const foulRate = clamp(
    0.22 + (stuff - batter.abilities.contact) / 500 + (action === 'power' ? 0.06 : 0),
    0.08,
    0.42,
  )
  if (rng.next() < foulRate) {
    return { kind: 'foul', text: 'ファウル' }
  }

  const edge =
    clamp((battingRating(batter) - pitchingRating(pitcher)) / 100, -1, 1) +
    (pitch.course.inZone ? 0.04 : -0.08)

  const batted = resolveBattedBall({
    batter,
    fielders,
    rng,
    edge,
    powerAdjust: action === 'power' ? 12 : action === 'contact' ? -6 : 0,
    hitAdjust: action === 'contact' ? 0.04 : action === 'power' ? -0.03 : 0,
  })

  return {
    kind: 'inplay',
    text: batted.text || OUTCOME_LABELS[batted.outcome] || batted.outcome,
    outcome: batted.outcome,
    location: batted.location,
  }
}

/** 現在の攻撃側チーム */
export const offenseTeam = (state) => (state.isTopHalf ? state.teams.away : state.teams.home)

/** 現在の守備側チーム */
export const defenseTeam = (state) => (state.isTopHalf ? state.teams.home : state.teams.away)

/** 現在の打者 */
export function currentBatter(state) {
  const order = battingOrder(offenseTeam(state))
  const key = state.isTopHalf ? 'away' : 'home'
  return order[state.batterIndex[key] % order.length]
}

/** 現在の投手 */
export const currentPitcher = (state) => startingPitcher(defenseTeam(state))

/** 1人プレイでプレイヤーが攻撃中か（＝打席操作をする番か） */
export function playerIsBatting(state) {
  return state.playerSide === (state.isTopHalf ? 'away' : 'home')
}

/**
 * いま操作するチーム。'home' か 'away' を返す。
 * 投球フェーズなら守備側、打席フェーズなら攻撃側。
 */
export function currentTurnSide(state) {
  if (state.finished) return null
  const defenseSide = state.isTopHalf ? 'home' : 'away'
  const offenseSide = state.isTopHalf ? 'away' : 'home'
  return state.phase === 'bat' ? offenseSide : defenseSide
}

/** 新しい試合を作る。mode は 'solo' か 'two-player'。 */
export function createLiveGame({
  homeTeam,
  awayTeam,
  playerSide = 'home',
  mode = 'solo',
  rng = createRng(1),
}) {
  const state = {
    inning: 1,
    isTopHalf: true,
    outs: 0,
    balls: 0,
    strikes: 0,
    runners: [null, null, null],
    score: { home: 0, away: 0 },
    linescore: { home: [], away: [] },
    finished: false,
    plays: [],
    log: [],
    lastPitch: null,
    batterIndex: { home: 0, away: 0 },
    teams: { home: homeTeam, away: awayTeam },
    playerSide,
    mode,
    phase: 'pitch',
    currentPitch: null,
  }

  refreshPhase(state, rng)
  return state
}

/** 現在の状況に合わせて「投げる番」か「打つ番」かを更新する */
export function refreshPhase(state, rng) {
  if (state.finished) {
    state.phase = 'finished'
    state.currentPitch = null
    return state
  }

  // 2人プレイは常に「投手が球種・コースを選ぶ」ところから始まる
  if (state.mode === 'two-player') {
    state.phase = 'pitch'
    state.currentPitch = null
    return state
  }

  if (playerIsBatting(state)) {
    state.phase = 'bat'
    state.currentPitch = chooseAiPitch(currentPitcher(state), rng, {
      balls: state.balls,
      strikes: state.strikes,
    })
  } else {
    state.phase = 'pitch'
    state.currentPitch = null
  }
  return state
}

/** プレイヤーが球種・コースを選んで投げる（相手の攻撃時） */
export function submitPitch(state, selection, rng) {
  if (state.finished || state.phase !== 'pitch') {
    throw new Error('いまは投球できません')
  }

  const pitch = selection.type ? selection : makePitch(selection.typeId, selection.courseId)

  // 2人プレイでは投手が選んだ球を保留し、打者側の操作を待つ
  if (state.mode === 'two-player') {
    state.currentPitch = pitch
    state.phase = 'bat'
    return state
  }

  const batter = currentBatter(state)
  const pitcher = currentPitcher(state)
  const fielders = buildFielders(defenseTeam(state))
  const action = chooseAiBattingAction({
    batter,
    pitch,
    count: { balls: state.balls, strikes: state.strikes },
    rng,
  })

  const result = resolveLivePitch({ batter, pitcher, fielders, pitch, action, rng })
  applyPitchResult(state, result, pitch, batter)
  refreshPhase(state, rng)
  return state
}

/** プレイヤーが打席で「見送る / ミート / 強振」を選ぶ */
export function submitBatting(state, action, rng) {
  if (state.finished || state.phase !== 'bat') {
    throw new Error('いまは打席操作できません')
  }
  if (!['take', 'contact', 'power'].includes(action)) {
    throw new RangeError(`未知の打撃操作です: ${action}`)
  }

  const pitch = state.currentPitch
  const batter = currentBatter(state)
  const pitcher = currentPitcher(state)
  const fielders = buildFielders(defenseTeam(state))

  const result = resolveLivePitch({ batter, pitcher, fielders, pitch, action, rng })
  applyPitchResult(state, result, pitch, batter)
  refreshPhase(state, rng)
  return state
}

/** 1 球の結果をカウント・走者・スコアへ反映する */
function applyPitchResult(state, result, pitch, batter) {
  const half = state.isTopHalf ? '表' : '裏'
  state.lastPitch = {
    inning: state.inning,
    half,
    batter: batter.name,
    pitch: pitchLabel(pitch),
    text: result.text,
    kind: result.kind,
  }
  state.log.push({ inning: state.inning, half, text: `${batter.name}: ${result.text}` })

  if (result.kind === 'ball') {
    state.balls += 1
    if (state.balls >= BALLS_FOR_WALK) finishPlateAppearance(state, OUTCOME.WALK, batter)
    return
  }

  if (result.kind === 'strike') {
    state.strikes += 1
    if (state.strikes >= STRIKES_FOR_OUT) {
      finishPlateAppearance(state, OUTCOME.STRIKEOUT, batter)
    }
    return
  }

  if (result.kind === 'foul') {
    if (state.strikes < 2) state.strikes += 1
    return
  }

  finishPlateAppearance(state, result.outcome, batter)
}

/** 打席が終わったときの処理 */
function finishPlateAppearance(state, outcome) {
  const batter = currentBatter(state)
  applyOffense(state, outcome, batter)

  const key = state.isTopHalf ? 'away' : 'home'
  state.batterIndex[key] += 1
  state.balls = 0
  state.strikes = 0

  state.plays.push({
    inning: state.inning,
    half: state.isTopHalf ? '表' : '裏',
    batter: batter.name,
    outcome,
    text: OUTCOME_LABELS[outcome] ?? outcome,
    score: { ...state.score },
  })

  // 9 回裏（以降）にホームが勝ち越したらサヨナラ
  if (!state.isTopHalf && state.inning >= INNINGS && state.score.home > state.score.away) {
    state.finished = true
    return
  }

  if (state.outs >= OUTS_PER_HALF_INNING) endHalfInning(state)
}

/** 3 アウトで攻守交代。9 回を終えたら試合終了。 */
function endHalfInning(state) {
  state.outs = 0
  state.balls = 0
  state.strikes = 0
  state.runners = [null, null, null]

  if (state.isTopHalf) {
    // 9 回表を終えてホームがリードしていれば、そのまま試合終了
    if (state.inning >= INNINGS && state.score.home > state.score.away) {
      state.finished = true
      return
    }
    state.isTopHalf = false
    return
  }

  if (state.inning >= INNINGS) {
    state.finished = true
    return
  }

  state.inning += 1
  state.isTopHalf = true
}

/** 安打・四球・アウトをスコアと走者へ反映する */
function applyOffense(state, outcome, batter) {
  const scoreKey = state.isTopHalf ? 'away' : 'home'

  if (outcome === OUTCOME.WALK) {
    const { runners, scored } = advanceOnWalk(state.runners)
    runners[0] = batter
    state.runners = runners
    addScore(state, scoreKey, scored)
    return
  }

  const bases = basesFor(outcome)
  if (bases === 0) {
    state.outs += 1
    return
  }

  const { runners, scored } = advanceRunners(state.runners, bases)
  if (bases > 3) {
    state.runners = [null, null, null]
    addScore(state, scoreKey, scored + 1)
    return
  }

  runners[0] = batter
  state.runners = runners
  addScore(state, scoreKey, scored)
}

function addScore(state, scoreKey, runs) {
  if (runs <= 0) return
  state.score[scoreKey] += runs
  state.linescore[scoreKey][state.inning - 1] =
    (state.linescore[scoreKey][state.inning - 1] ?? 0) + runs
}

/**
 * 試合を最後まで自動進行する（両チームとも AI が操作）。
 * テストや「最後まで見る」ボタンで使う。
 */
export function autoPlayLiveGame(state, rng) {
  let guard = 0
  while (!state.finished && guard < 5000) {
    guard += 1
    if (state.phase === 'pitch') {
      const pitch = chooseAiPitch(currentPitcher(state), rng, {
        balls: state.balls,
        strikes: state.strikes,
      })
      submitPitch(state, pitch, rng)
      continue
    }
    if (state.phase === 'bat') {
      const action = chooseAiBattingAction({
        batter: currentBatter(state),
        pitch: state.currentPitch,
        count: { balls: state.balls, strikes: state.strikes },
        rng,
      })
      submitBatting(state, action, rng)
      continue
    }
    break
  }
  return state
}
