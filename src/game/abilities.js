/** 能力値を 0〜100 に丸める（UI や外部データからの入力を正規化する） */
export function normalizeAbility(value) {
  return Math.min(100, Math.max(1, Math.round(Number(value) || 0)))
}

/** 打撃能力値の項目定義。UI のラベル・並び順・重み付けに使う。 */
export const BATTING_ABILITIES = {
  contact: { label: 'ミート', weight: 0.35 },
  power: { label: '長打力', weight: 0.35 },
  speed: { label: '走力', weight: 0.2 },
  approach: { label: '選球', weight: 0.1 },
}

/** 投球能力値の項目定義 */
export const PITCHING_ABILITIES = {
  velocity: { label: '球速', weight: 0.3 },
  control: { label: '制球', weight: 0.35 },
  breaking: { label: '変化球', weight: 0.2 },
  stamina: { label: 'スタミナ', weight: 0.15 },
}

/** 守備能力値の項目定義 */
export const FIELDING_ABILITIES = {
  fielding: { label: '守備', weight: 0.4 },
  arm: { label: '肩', weight: 0.35 },
  throwing: { label: '送球', weight: 0.25 },
}

export const ALL_ABILITIES = {
  ...BATTING_ABILITIES,
  ...PITCHING_ABILITIES,
  ...FIELDING_ABILITIES,
}

/** 打撃の総合評価に使う重み。選球の比重は意図的に低くしている。 */
const BATTING_WEIGHT = { contact: 0.34, power: 0.3, speed: 0.2, approach: 0.16 }

/** 投球の総合評価に使う重み。制球を最も重視する。 */
const PITCHING_WEIGHT = { velocity: 0.28, control: 0.34, breaking: 0.23, stamina: 0.15 }

/** 守備の総合評価に使う重み。 */
const FIELDING_WEIGHT = { fielding: 0.42, arm: 0.33, throwing: 0.25 }

function weighted(abilities, weights) {
  let total = 0
  for (const [key, weight] of Object.entries(weights)) {
    total += normalizeAbility(abilities[key]) * weight
  }
  return Math.round(total)
}

/** 打撃的综合評価 (0〜100) */
export const battingRating = (player) => weighted(player.abilities, BATTING_WEIGHT)

/** 投球の総合評価 (0〜100) */
export const pitchingRating = (player) => weighted(player.abilities, PITCHING_WEIGHT)

/** 守備の総合評価 (0〜100) */
export const fieldingRating = (player) => weighted(player.abilities, FIELDING_WEIGHT)

/**
 * 特定の守備位置での守備評価 (0〜100)。
 * 基礎の守備力に、その位置への適性（positionFit）を掛け合わせる。
 */
export function fieldingAtPosition(player, positionId) {
  const base = fieldingRating(player)
  const fit = player.positionFit?.[positionId] ?? 50
  // 適性 50 で等倍、100 で約 1.15 倍、0 で約 0.85 倍になるよう調整
  const multiplier = 0.85 + (fit / 100) * 0.3
  return Math.round(base * multiplier)
}

/** 選手としての総合推定評価 (0〜100)。守備適性は見ていない。 */
export function overallRating(player) {
  return Math.round((battingRating(player) + fieldingRating(player)) / 2)
}

/** 表示用の 5 段階評価（100 なら ★5） */
export function starRating(value) {
  if (value >= 90) return 5
  if (value >= 75) return 4
  if (value >= 60) return 3
  if (value >= 40) return 2
  return 1
}
