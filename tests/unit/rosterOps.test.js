import { describe, expect, it } from 'vitest'
import {
  orderText,
  rosterTable,
  swapBattingOrder,
  swapPositions,
  swapWithBench,
} from '../../src/ui/rosterOps.js'
import { battingOrder, createPlayer, createTeam, validateLineup } from '../../src/game/roster.js'
import { POSITION_IDS } from '../../src/game/positions.js'

function makePlayer(id, overrides = {}) {
  return createPlayer({
    id,
    name: overrides.name ?? `選手${id}`,
    number: 1,
    abilities: { contact: 50, power: 50 },
    positionFit: Object.fromEntries(POSITION_IDS.map((p) => [p, 50])),
    ...overrides,
  })
}

/** 名前が位置と一致する、9 枠のチーム */
function makeTeam() {
  const starters = POSITION_IDS.map((positionId, index) => ({
    player: makePlayer(`${positionId}`, { name: `${positionId}選手` }),
    position: positionId,
    battingOrder: index + 1,
  }))

  return createTeam({
    name: 'テスト',
    color: '#000',
    starters,
    bench: [makePlayer('benchA', { name: '控えA' }), makePlayer('benchB', { name: '控えB' })],
  })
}

describe('swapBattingOrder', () => {
  it('2 人の打席順を入れ替える', () => {
    const team = makeTeam()
    const before = battingOrder(team).map((p) => p.id)
    const next = swapBattingOrder(team.starters, 0, 2)
    const after = [...next]
      .sort((a, b) => a.battingOrder - b.battingOrder)
      .map((slot) => slot.player.id)

    expect(before).toEqual(['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'])
    expect(after[0]).toBe('1B')
    expect(after[2]).toBe('P')
  })

  it('同じ位置指定なら変化しない', () => {
    const team = makeTeam()
    const before = battingOrder(team).map((p) => p.id)
    const after = swapBattingOrder(team.starters, 3, 3)
      .sort((a, b) => a.battingOrder - b.battingOrder)
      .map((slot) => slot.player.id)

    expect(after).toEqual(before)
  })

  it('範囲外の添字は端に丸められる', () => {
    const team = makeTeam()
    const result = swapBattingOrder(team.starters, -5, 99)
    expect(result).toHaveLength(9)
    expect(validateLineup({ ...team, starters: result }).valid).toBe(true)
  })

  it('打席順は 1〜9 が重複なく並ぶ', () => {
    const team = makeTeam()
    const result = swapBattingOrder(team.starters, 4, 0)
    const orders = result.map((slot) => slot.battingOrder).sort((a, b) => a - b)
    expect(orders).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })
})

describe('swapPositions', () => {
  it('2 つの守備位置を入れ替える', () => {
    const team = makeTeam()
    const next = swapPositions(team.starters, 'SS', 'LF')
    const ss = next.find((slot) => slot.position === 'SS')
    const lf = next.find((slot) => slot.position === 'LF')

    expect(lf.player.id).toBe('SS')
    expect(ss.player.id).toBe('LF')
  })

  it('元の配列を変更しない', () => {
    const team = makeTeam()
    swapPositions(team.starters, 'SS', 'LF')
    expect(team.starters.find((slot) => slot.position === 'SS').player.id).toBe('SS')
  })

  it('未知の位置を指定しても壊れない', () => {
    const team = makeTeam()
    const result = swapPositions(team.starters, 'SS', 'ZZ')
    expect(result).toHaveLength(9)
  })

  it('入れ替えても 9 枠は保たれる', () => {
    const team = makeTeam()
    const next = swapPositions(team.starters, 'P', 'C')
    expect(validateLineup({ ...team, starters: next }).valid).toBe(true)
  })
})

describe('swapWithBench', () => {
  it('1 番の打席と控えを交換する', () => {
    const team = makeTeam()
    const next = swapWithBench(team, 0, 0)
    const order = battingOrder(next)

    expect(order[0].id).toBe('benchA')
    expect(next.bench[0].id).toBe('P')
  })

  it('交換後も 9 人 + 控え 2 人の構成を保つ', () => {
    const team = makeTeam()
    const next = swapWithBench(team, 0, 1)

    expect(next.starters).toHaveLength(9)
    expect(next.bench).toHaveLength(2)
    expect(validateLineup(next).valid).toBe(true)
  })

  it('範囲外の添字ならそのまま返す', () => {
    const team = makeTeam()
    expect(swapWithBench(team, 99, 0)).toBe(team)
    expect(swapWithBench(team, 0, 99)).toBe(team)
  })
})

describe('rosterTable', () => {
  it('出場 9 人 + 控えを順に返す', () => {
    const team = makeTeam()
    const table = rosterTable(team)

    expect(table).toHaveLength(11)
    expect(table.filter((row) => !row.isBench)).toHaveLength(9)
    expect(table.filter((row) => row.isBench)).toHaveLength(2)
  })

  it('出場枠の行には打席順と守備位置が入る', () => {
    const team = makeTeam()
    const table = rosterTable(team)
    const first = table.find((row) => !row.isBench)

    expect(first.battingOrder).toBe(1)
    expect(first.position).toBe('P')
  })

  it('控えの行には打席順が入らない', () => {
    const team = makeTeam()
    const table = rosterTable(team)
    const benchRow = table.find((row) => row.isBench)

    expect(benchRow.battingOrder).toBeNull()
    expect(benchRow.benchIndex).toBe(0)
  })
})

describe('orderText', () => {
  it('打席順をテキストにする', () => {
    const team = makeTeam()
    const text = orderText(team)
    expect(text).toContain('1. P選手')
    expect(text).toContain('9. RF選手')
  })
})
