import { normalizeAbility } from './abilities.js'
import { ON_FIELD_COUNT, POSITION_IDS } from './positions.js'

/**
 * チームの編成モデル。
 *
 * ルール:
 * - 出場できるのは 9 人。守備位置ごとに 1 人ずつで、DH は置いていない。
 * - 控えは最大 8 人。合わせて 17 人まで登録できる。
 * - 名簿に登録できる投手は最大 6 人。投手は投手枠にだけ置ける。
 */

/** 出場枠の数 */
export const ROSTER_SLOTS = ON_FIELD_COUNT

/** 控えの最大人数 */
export const MAX_BENCH = 8

/** 1 試合で登板できる投手の上限 */
export const MAX_PITCHERS_PER_GAME = 4

/** 名簿に登録できる投手の上限 */
export const MAX_PITCHERS_ON_ROSTER = 6

/** 能力値のキー一覧。順序は保存時の安定性に関わるため変えないこと。 */
export const ABILITY_KEYS = [
  'contact',
  'power',
  'speed',
  'approach',
  'velocity',
  'control',
  'breaking',
  'stamina',
  'fielding',
  'arm',
  'throwing',
]

/** 新規選手を作る。positionFit は守備位置ごとの適性 (0〜100)。 */
export function createPlayer({
  id,
  name,
  number,
  bats = 'right',
  throws = 'right',
  age = 17,
  height = 175,
  weight = 68,
  isPitcher = false,
  abilities = {},
  positionFit = {},
  homePosition = null,
}) {
  const normalized = {}
  for (const key of ABILITY_KEYS) {
    normalized[key] = normalizeAbility(abilities[key] ?? 40)
  }

  return {
    id,
    name,
    number,
    bats,
    throws,
    age,
    height,
    weight,
    isPitcher,
    abilities: normalized,
    positionFit,
    // 生成時の主位置。自動編成ではこの位置を守る
    homePosition,
  }
}

/**
 * チームを作る。
 *
 * starters は { player, position, battingOrder } の配列で、打席順の昇順。
 * battingOrder は 1 始まり。position は POSITION_IDS のいずれか。
 */
export function createTeam({ name, color = '#4a90d9', shortName = '', starters, bench = [] }) {
  return {
    name,
    shortName: shortName || name.slice(0, 4),
    color,
    starters: starters.map((slot) => ({ ...slot })),
    bench: [...bench],
  }
}

/** チーム名を変更した新しいチームを返す。空の名前なら null を返す。 */
export function renameTeam(team, name) {
  const nextName = String(name ?? '')
    .trim()
    .slice(0, 20)
  if (!nextName) return null

  return {
    ...team,
    name: nextName,
    shortName: nextName.slice(0, 4),
  }
}

/** 出場 9 人の選手（スロットではなく選手オブジェクトを返す） */
export const activePlayers = (team) => team.starters.map((slot) => slot.player)

/** 名簿全員（出場 + 控え） */
export const allPlayers = (team) => [...activePlayers(team), ...team.bench]

/**
 * 能力値を更新した新しい選手を返す。元の選手オブジェクトは変更しない。
 * 指定しなかった能力値はそのまま残り、指定した値は 1〜100 に丸められる。
 */
export function updatePlayerAbilities(player, patch) {
  const abilities = { ...player.abilities }
  for (const key of ABILITY_KEYS) {
    if (patch[key] !== undefined) abilities[key] = normalizeAbility(patch[key])
  }
  return { ...player, abilities }
}

/** プロフィール（名前・背番号など）を更新した新しい選手を返す */
export function updatePlayerProfile(player, patch) {
  const next = { ...player }

  if (patch.name !== undefined) {
    const name = String(patch.name).trim()
    if (name) next.name = name.slice(0, 20)
  }
  if (patch.number !== undefined) {
    const number = Number(patch.number)
    if (Number.isFinite(number)) next.number = Math.min(99, Math.max(0, Math.round(number)))
  }
  if (patch.bats !== undefined && ['right', 'left', 'switch'].includes(patch.bats)) {
    next.bats = patch.bats
  }
  if (patch.throws !== undefined && ['right', 'left'].includes(patch.throws)) {
    next.throws = patch.throws
  }
  return next
}

/** 守備位置ごとの適性を更新した新しい選手を返す */
export function updatePositionFit(player, patch) {
  const positionFit = { ...player.positionFit }
  for (const positionId of POSITION_IDS) {
    if (patch[positionId] !== undefined) {
      positionFit[positionId] = normalizeAbility(patch[positionId])
    }
  }
  return { ...player, positionFit }
}

/** チーム内の選手を差し替える（出場・控えのどちらでも探す） */
export function replacePlayer(team, playerId, nextPlayer) {
  return {
    ...team,
    starters: team.starters.map((slot) =>
      slot.player.id === playerId ? { ...slot, player: nextPlayer } : slot,
    ),
    bench: team.bench.map((player) => (player.id === playerId ? nextPlayer : player)),
  }
}

/** チーム内の選手を id で引く */
export function findPlayer(team, playerId) {
  return allPlayers(team).find((player) => player.id === playerId) ?? null
}

/** 指定の守備位置にいる選手を返す */
export function playerAtPosition(team, positionId) {
  const slot = team.starters.find((entry) => entry.position === positionId)
  return slot ? slot.player : null
}

/** 先発投手 */
export const startingPitcher = (team) => playerAtPosition(team, 'P')

/** 打席順に並べた出場 9 人 */
export const battingOrder = (team) =>
  [...team.starters].sort((a, b) => a.battingOrder - b.battingOrder).map((slot) => slot.player)

/** 名簿の中で投手が使える選手 */
export const availablePitchers = (team) => allPlayers(team).filter((player) => player.isPitcher)

/**
 * 編成が正しいかを検証する。
 * errors は日本語のメッセージ配列。valid は errors が空かどうか。
 */
export function validateLineup(team) {
  const errors = []

  if (team.starters.length !== ROSTER_SLOTS) {
    errors.push(`出場枠は ${ROSTER_SLOTS} 人必要です（現在 ${team.starters.length} 人）`)
  }

  if (team.bench.length > MAX_BENCH) {
    errors.push(`控えは最大 ${MAX_BENCH} 人までです（現在 ${team.bench.length} 人）`)
  }

  const ids = allPlayers(team).map((player) => player.id)
  if (new Set(ids).size !== ids.length) {
    errors.push('選手の id が重複しています')
  }

  const positions = team.starters.map((slot) => slot.position)
  for (const positionId of POSITION_IDS) {
    const count = positions.filter((position) => position === positionId).length
    if (count === 0) errors.push(`${positionId} の守備位置が空いています`)
    if (count > 1) errors.push(`${positionId} に ${count} 人登録されています（1 人だけ）`)
  }

  for (const position of positions) {
    if (!POSITION_IDS.includes(position)) errors.push(`未知の守備位置です: ${position}`)
  }

  const orders = team.starters.map((slot) => slot.battingOrder)
  const expected = Array.from({ length: ROSTER_SLOTS }, (_, i) => i + 1)
  if (new Set(orders).size !== orders.length) errors.push('打席順が重複しています')
  for (const order of expected) {
    if (!orders.includes(order)) errors.push(`打席順 ${order} 番が空いています`)
  }

  const pitchers = availablePitchers(team).length
  if (pitchers > MAX_PITCHERS_ON_ROSTER) {
    errors.push(`投手は最大 ${MAX_PITCHERS_ON_ROSTER} 人までです（現在 ${pitchers} 人）`)
  }

  for (const slot of team.starters) {
    if (slot.position !== 'P' && slot.player.isPitcher) {
      errors.push(`${slot.player.name} は投手のため守備位置には置けません`)
    }
  }

  return { valid: errors.length === 0, errors }
}
