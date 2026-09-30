import { createRng } from './rng.js'
import { addLog, applyBall, applyFoul, applyHit, applyStrike, currentBatter } from './gameState.js'

/** 投球ライブラリ。球種は後から追加できる。 */
export const PITCHES = [
  { id: 'straight', label: 'ストレート', speed: 148, color: '#d9534f' },
  { id: 'curve', label: 'カーブ', speed: 132, color: '#2f9e6b' },
  { id: 'change', label: 'チェンジ', speed: 138, color: '#f5a524' },
  { id: 'slider', label: 'スライダー', speed: 140, color: '#4a90d9' },
]

export const PITCH_BY_ID = Object.fromEntries(PITCHES.map((pitch) => [pitch.id, pitch]))

/**
 * 球種ごとの結果確率。
 * ball / foul / hit / strike の合計が 1 になるように定義する。
 */
export const PITCH_PROBABILITIES = {
  straight: { ball: 0.16, foul: 0.2, hit: 0.22, strike: 0.42 },
  curve: { ball: 0.24, foul: 0.18, hit: 0.24, strike: 0.34 },
  change: { ball: 0.22, foul: 0.16, hit: 0.26, strike: 0.36 },
  slider: { ball: 0.19, foul: 0.2, hit: 0.23, strike: 0.38 },
}

/** ヒットになった場合の打球分布（1 塁安打 / 二塁安打 / 三塁安打 / ホームラン） */
export const HIT_DISTRIBUTION = [
  { bases: 1, weight: 0.7 },
  { bases: 2, weight: 0.2 },
  { bases: 3, weight: 0.06 },
  { bases: 4, weight: 0.04 },
]

const HIT_LABELS = {
  1: '一塁安打',
  2: '二塁安打',
  3: '三塁安打',
  4: 'ホームラン',
}

/** シードを進める（LCG）。同じシード列なら常に同じ試合結果になる。 */
function advanceSeed(seed) {
  return (seed * 1103515245 + 12345) % 2147483647
}

/**
 * 1 球を投げて結果を state に適用し、ログと表示用テキストを返す。
 * 副作用: state の ball / strike / outs / runners / score と rngSeed を更新する。
 */
export function throwPitch(state, pitchId) {
  const pitch = PITCH_BY_ID[pitchId]
  if (!pitch) throw new Error(`未知の球種です: ${pitchId}`)

  const rng = createRng(state.rngSeed)
  state.rngSeed = advanceSeed(state.rngSeed)

  const probs = PITCH_PROBABILITIES[pitch.id]
  const roll = rng.next()

  let cumulative = 0
  let outcome = 'strike'
  for (const key of ['ball', 'foul', 'hit']) {
    cumulative += probs[key]
    if (roll < cumulative) {
      outcome = key
      break
    }
  }

  const batter = currentBatter(state)
  let text = `${pitch.label} (${pitch.speed}km/h)`

  switch (outcome) {
    case 'ball': {
      const result = applyBall(state)
      text += result.walk ? ' → 四球' : ' → ボール'
      break
    }
    case 'foul': {
      applyFoul(state)
      text += ' → ファウル'
      break
    }
    case 'hit': {
      const bases = rng.weighted(HIT_DISTRIBUTION, (hit) => hit.weight).bases
      const result = applyHit(state, bases)
      text += ` → ${HIT_LABELS[bases]}`
      if (result.scored > 0) text += ` ${result.scored}点`
      break
    }
    default: {
      const result = applyStrike(state)
      text += result.strikeout ? ' → 三振' : ' → ストライク'
      break
    }
  }

  addLog(state, text)
  return { text, outcome, pitch, batter }
}
