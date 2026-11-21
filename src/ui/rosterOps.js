import { battingOrder, findPlayer } from '../game/roster.js'

/** 打席順を入れ替える（UI の「上へ / 下へ」用） */
export function swapBattingOrder(starters, fromIndex, toIndex) {
  const sorted = [...starters].sort((a, b) => a.battingOrder - b.battingOrder)
  const source = Math.max(0, Math.min(sorted.length - 1, fromIndex))
  const target = Math.max(0, Math.min(sorted.length - 1, toIndex))
  if (source === target) return sorted

  const a = sorted[source]
  const b = sorted[target]
  a.battingOrder = target + 1
  b.battingOrder = source + 1

  return sorted
}

/** 2 つの守備位置を入れ替える */
export function swapPositions(starters, positionA, positionB) {
  const next = starters.map((slot) => ({ ...slot }))
  const slotA = next.find((slot) => slot.position === positionA)
  const slotB = next.find((slot) => slot.position === positionB)
  if (!slotA || !slotB) return starters

  slotA.position = positionB
  slotB.position = positionA
  return next
}

/** 出場選手と控えを入れ替える */
export function swapWithBench(team, starterIndex, benchIndex) {
  const sorted = [...team.starters].sort((a, b) => a.battingOrder - b.battingOrder)
  const slot = sorted[starterIndex]
  const benchPlayer = team.bench[benchIndex]
  if (!slot || !benchPlayer) return team

  const nextBench = [...team.bench]
  nextBench[benchIndex] = slot.player

  const nextStarters = sorted.map((entry, index) =>
    index === starterIndex
      ? { player: benchPlayer, position: entry.position, battingOrder: entry.battingOrder }
      : { ...entry },
  )

  return { ...team, starters: nextStarters, bench: nextBench }
}

/** 打席順をテキストにする */
export function orderText(team) {
  return battingOrder(team)
    .map((player, index) => `${index + 1}. ${player.name}`)
    .join('  ')
}

/** 表示用の表（出場 9 人 + 控え）にまとめる */
export function rosterTable(team) {
  const starters = battingOrder(team).map((player, index) => {
    const slot = team.starters.find((entry) => entry.player.id === player.id)
    return {
      battingOrder: index + 1,
      player,
      position: slot ? slot.position : '',
      isBench: false,
      starterIndex: index,
    }
  })

  const bench = team.bench.map((player, index) => ({
    battingOrder: null,
    player,
    position: '',
    isBench: true,
    benchIndex: index,
  }))

  return [...starters, ...bench]
}

/** 選手が見つからないときのメッセージ */
export function missingPlayerMessage(team, playerId) {
  return findPlayer(team, playerId) ? null : '選手が見つかりません'
}
