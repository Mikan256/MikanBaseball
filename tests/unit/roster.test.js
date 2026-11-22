import { describe, expect, it } from 'vitest'
import {
  MAX_BENCH,
  MAX_PITCHERS_ON_ROSTER,
  ROSTER_SLOTS,
  addBenchPlayer,
  allPlayers,
  availablePitchers,
  battingOrder,
  createPlayer,
  createTeam,
  findPlayer,
  playerAtPosition,
  removeBenchPlayer,
  replacePlayer,
  startingPitcher,
  updatePlayerAbilities,
  updatePlayerProfile,
  updatePositionFit,
  validateLineup,
} from '../../src/game/roster.js'
import { ON_FIELD_COUNT, POSITION_IDS } from '../../src/game/positions.js'
import { createRng } from '../../src/game/rng.js'
import { randomTeam } from '../../src/data/rosterFactory.js'

/** 全能力値が指定値を持つ選手を作る */
function makePlayer(id, overrides = {}) {
  return createPlayer({
    id,
    name: overrides.name ?? `選手${id}`,
    number: 10,
    isPitcher: false,
    abilities: { contact: 50, power: 50, fielding: 50 },
    positionFit: Object.fromEntries(POSITION_IDS.map((p) => [p, 50])),
    ...overrides,
  })
}

/** 9 枠を埋めたチームを作る（playerIndex で選手を差し替えられる） */
function makeTeam(playerBuilder = (positionId, index) => makePlayer(`${positionId}-${index}`)) {
  const starters = POSITION_IDS.map((positionId, index) => ({
    player: playerBuilder(positionId, index),
    position: positionId,
    battingOrder: index + 1,
  }))

  return createTeam({ name: 'テストチーム', color: '#000', starters })
}

describe('定数', () => {
  it('出場枠は 9 人で、DH を含まない', () => {
    expect(ON_FIELD_COUNT).toBe(9)
    expect(ROSTER_SLOTS).toBe(9)
    expect(POSITION_IDS).toEqual(['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'])
  })

  it('控えは最大 8 人、投手の登録は最大 6 人', () => {
    expect(MAX_BENCH).toBe(8)
    expect(MAX_PITCHERS_ON_ROSTER).toBe(6)
  })
})

describe('createPlayer', () => {
  it('能力値が 0〜100 に丸めて保存される', () => {
    const player = makePlayer('a', { abilities: { contact: 120, power: -5, fielding: 55.6 } })
    expect(player.abilities.contact).toBe(100)
    expect(player.abilities.power).toBe(1)
    expect(player.abilities.fielding).toBe(56)
  })

  it('未指定の能力値には既定値が入る', () => {
    const player = makePlayer('b')
    expect(player.abilities.speed).toBeGreaterThan(0)
    expect(player.abilities.stamina).toBeGreaterThan(0)
  })
})

describe('createTeam', () => {
  it('9 枠 + 打席順 + 守備位置を持つ', () => {
    const team = makeTeam()
    expect(team.starters).toHaveLength(9)
    expect(battingOrder(team)).toHaveLength(9)
    expect(playerAtPosition(team, 'SS')).not.toBeNull()
    expect(team.starters.map((slot) => slot.position).sort()).toEqual([...POSITION_IDS].sort())
  })

  it('配列をコピーするので元の配列を変更しない', () => {
    const player = makePlayer('a')
    const starters = [{ player, position: 'P', battingOrder: 1 }]
    const team = createTeam({ name: 't', starters, bench: [] })
    starters.push({ player, position: 'C', battingOrder: 2 })
    expect(team.starters).toHaveLength(1)
  })
})

describe('参照ヘルパ', () => {
  it('playerAtPosition で守備位置の選手を引ける', () => {
    const team = makeTeam()
    const pitcher = playerAtPosition(team, 'P')
    expect(pitcher).not.toBeNull()
    expect(startingPitcher(team).id).toBe(pitcher.id)
  })

  it('findPlayer は出場と控えの両方から引ける', () => {
    const team = makeTeam()
    team.bench.push(makePlayer('bench1'))
    expect(findPlayer(team, 'bench1')).not.toBeNull()
    expect(findPlayer(team, '存在しない')).toBeNull()
  })

  it('allPlayers は出場 9 人 + 控えを返す', () => {
    const team = makeTeam()
    team.bench.push(makePlayer('b1'), makePlayer('b2'))
    expect(allPlayers(team)).toHaveLength(11)
  })

  it('battingOrder は打席順で並べる', () => {
    const team = makeTeam()
    const reversed = { ...team, starters: [...team.starters].reverse() }
    const order = battingOrder(reversed)
    expect(order[0].id).toBe('P-0')
    expect(order[8].id).toBe('RF-8')
  })
})

describe('validateLineup', () => {
  it('9 人で全位置埋まっていれば有効', () => {
    const result = validateLineup(makeTeam())
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('9 人未満なら無効', () => {
    const team = makeTeam()
    team.starters = team.starters.slice(0, 8)
    const result = validateLineup(team)
    expect(result.valid).toBe(false)
    expect(result.errors.join()).toContain('9')
  })

  it('同じ守備位置に 2 人在るとエラー', () => {
    const team = makeTeam()
    team.starters[1].position = 'P'
    const result = validateLineup(team)
    expect(result.valid).toBe(false)
    expect(result.errors.join()).toContain('P')
  })

  it('未知の守備位置はエラー', () => {
    const team = makeTeam()
    team.starters[0].position = 'DH'
    const result = validateLineup(team)
    expect(result.valid).toBe(false)
    expect(result.errors.join()).toContain('DH')
  })

  it('打席順が重複したらエラー', () => {
    const team = makeTeam()
    team.starters[3].battingOrder = 1
    const result = validateLineup(team)
    expect(result.valid).toBe(false)
    expect(result.errors.join()).toContain('打席順')
  })

  it('控えが 8 人を超えるとエラー', () => {
    const team = makeTeam()
    team.bench = Array.from({ length: 9 }, (_, i) => makePlayer(`b${i}`))
    const result = validateLineup(team)
    expect(result.valid).toBe(false)
    expect(result.errors.join()).toContain('控え')
  })

  it('選手 id が重複したらエラー', () => {
    const team = makeTeam(() => makePlayer('same'))
    const result = validateLineup(team)
    expect(result.valid).toBe(false)
    expect(result.errors.join()).toContain('id')
  })

  it('投手が守備位置にいてもエラー（DH 以外には置けない）', () => {
    const team = makeTeam((positionId, index) =>
      makePlayer(`${positionId}-${index}`, { isPitcher: positionId === 'SS' }),
    )
    const result = validateLineup(team)
    expect(result.valid).toBe(false)
    expect(result.errors.join()).toContain('投手')
  })

  it('投手が 7 人以上だとエラー', () => {
    const team = makeTeam()
    team.bench = Array.from({ length: 7 }, (_, i) => makePlayer(`bp${i}`, { isPitcher: true }))
    const result = validateLineup(team)
    expect(result.valid).toBe(false)
    expect(result.errors.join()).toContain('投手は最大')
  })
})

describe('availablePitchers', () => {
  it('isPitcher が true の選手だけを返す', () => {
    const team = makeTeam((positionId, index) =>
      makePlayer(`${positionId}-${index}`, { isPitcher: positionId === 'P' }),
    )
    expect(availablePitchers(team)).toHaveLength(1)
  })

  it('控えの投手も含める', () => {
    const team = makeTeam()
    team.bench = [makePlayer('bp', { isPitcher: true })]
    expect(availablePitchers(team)).toHaveLength(1)
  })
})

describe('randomTeam', () => {
  it('9 人 + 控え 5 人で有効な編成になる', () => {
    for (const seed of [1, 2, 42, 999]) {
      const team = randomTeam({ name: 'テスト', seed })
      const result = validateLineup(team)

      expect(team.starters).toHaveLength(9)
      expect(team.bench).toHaveLength(5)
      expect(result.valid).toBe(true)
    }
  })

  it('同じシードなら同じ選手を生成する', () => {
    const a = randomTeam({ name: 'テスト', seed: 77 })
    const b = randomTeam({ name: 'テスト', seed: 77 })

    expect(battingOrder(a).map((p) => p.id)).toEqual(battingOrder(b).map((p) => p.id))
    expect(battingOrder(a).map((p) => p.abilities)).toEqual(battingOrder(b).map((p) => p.abilities))
  })

  it('投手が必ず 1 人は P にいる', () => {
    for (const seed of [1, 7, 100, 555]) {
      const team = randomTeam({ name: 'テスト', seed })
      expect(playerAtPosition(team, 'P')?.isPitcher).toBe(true)
    }
  })

  it('9 人に必ず 9 つの異なる守備位置がある', () => {
    for (const seed of [3, 21, 400]) {
      const team = randomTeam({ name: 'テスト', seed })
      const positions = team.starters.map((slot) => slot.position).sort()
      expect(positions).toEqual([...POSITION_IDS].sort())
    }
  })

  it('打席順が 1 から 9 まで重複なく並ぶ', () => {
    for (const seed of [5, 88, 1234]) {
      const team = randomTeam({ name: 'テスト', seed })
      const orders = team.starters.map((slot) => slot.battingOrder).sort((a, b) => a - b)
      expect(orders).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    }
  })

  it('大量のシードでも常に有効な編成になる', () => {
    // 以前、位置適性から守備位置を選んでいたら複数の選手が一か所に集まりえた
    for (let seed = 0; seed < 300; seed += 1) {
      const result = validateLineup(randomTeam({ name: 'テスト', seed }))
      expect(result.valid, `seed ${seed}: ${result.errors.join()}`).toBe(true)
    }
  })

  it('控えの人数を変えても編成は有効', () => {
    for (const benchCount of [0, 1, 5, 8]) {
      const team = randomTeam({ name: 'テスト', seed: 7, benchCount })
      const result = validateLineup(team)

      expect(team.bench, `benchCount ${benchCount}`).toHaveLength(benchCount)
      expect(result.valid, `benchCount ${benchCount}: ${result.errors.join()}`).toBe(true)
    }
  })

  it('能力値がすべて 1〜100 の範囲に収まる', () => {
    const team = randomTeam({ name: 'テスト', seed: 31337 })
    for (const player of allPlayers(team)) {
      for (const [key, value] of Object.entries(player.abilities)) {
        expect(value, key).toBeGreaterThanOrEqual(1)
        expect(value, key).toBeLessThanOrEqual(100)
      }
    }
  })

  it('生成は RNG を渡さなくても動く', () => {
    expect(() => randomTeam({ name: 'テスト' })).not.toThrow()
  })
})

describe('選手の編集', () => {
  it('能力値を 1〜100 に丸めて更新し、元の選手は変えない', () => {
    const player = makePlayer('edit', { abilities: { contact: 55, power: 60 } })
    const next = updatePlayerAbilities(player, { contact: 120, power: -5, speed: 77.6 })

    expect(next.abilities.contact).toBe(100)
    expect(next.abilities.power).toBe(1)
    expect(next.abilities.speed).toBe(78)
    expect(player.abilities.contact).toBe(55)
    expect(player.abilities.power).toBe(60)
  })

  it('指定しなかった能力値は元の値を引き継ぐ', () => {
    const player = makePlayer('edit2', { abilities: { contact: 55, power: 60, speed: 44 } })
    const next = updatePlayerAbilities(player, { contact: 70 })

    expect(next.abilities.contact).toBe(70)
    expect(next.abilities.power).toBe(60)
    expect(next.abilities.speed).toBe(44)
  })

  it('プロフィールを更新できる', () => {
    const player = makePlayer('profile')
    const next = updatePlayerProfile(player, {
      name: '  山田 太郎  ',
      number: 150,
      bats: 'left',
      throws: 'left',
    })

    expect(next.name).toBe('山田 太郎')
    expect(next.number).toBe(99)
    expect(next.bats).toBe('left')
    expect(next.throws).toBe('left')
    expect(player.name).toBe('選手profile')
  })

  it('空の名前や不正な打席は無視する', () => {
    const player = makePlayer('profile2', { name: '元の名前' })
    const next = updatePlayerProfile(player, { name: '   ', bats: 'both' })

    expect(next.name).toBe('元の名前')
    expect(next.bats).toBe('right')
  })

  it('守備位置の適性を更新できる', () => {
    const player = makePlayer('fit')
    const next = updatePositionFit(player, { SS: 200, CF: 0 })

    expect(next.positionFit.SS).toBe(100)
    expect(next.positionFit.CF).toBe(1)
    expect(player.positionFit.SS).toBe(50)
  })

  it('replacePlayer は出場・控えの両方を差し替える', () => {
    const team = makeTeam()
    team.bench.push(makePlayer('benchX'))

    const starter = updatePlayerProfile(team.starters[0].player, { name: '新しい先発' })
    const replacedStarter = replacePlayer(team, team.starters[0].player.id, starter)
    expect(replacedStarter.starters[0].player.name).toBe('新しい先発')

    const bench = updatePlayerProfile(team.bench[0], { name: '新しい控え' })
    const replacedBench = replacePlayer(team, team.bench[0].id, bench)
    expect(replacedBench.bench[0].name).toBe('新しい控え')
    expect(team.bench[0].name).toBe('選手benchX')
  })
})

describe('控えの追加・削除', () => {
  it('控えを追加でき、元のチームは変わらない', () => {
    const team = makeTeam()
    const player = makePlayer('benchNew')
    const next = addBenchPlayer(team, player)

    expect(next.bench).toHaveLength(team.bench.length + 1)
    expect(next.bench.at(-1).id).toBe('benchNew')
    expect(team.bench).toHaveLength(0)
  })

  it('上限 8 人を超えて追加しない', () => {
    const team = makeTeam()
    team.bench = Array.from({ length: MAX_BENCH }, (_, i) => makePlayer(`b${i}`))
    const next = addBenchPlayer(team, makePlayer('over'))

    expect(next).toBe(team)
    expect(next.bench).toHaveLength(MAX_BENCH)
  })

  it('同じ id の選手は追加しない', () => {
    const team = makeTeam()
    const player = makePlayer('same')
    team.bench = [player]
    const next = addBenchPlayer(team, player)

    expect(next).toBe(team)
  })

  it('指定した控えを削除できる', () => {
    const team = makeTeam()
    team.bench = [makePlayer('a'), makePlayer('b'), makePlayer('c')]
    const next = removeBenchPlayer(team, 1)

    expect(next.bench.map((player) => player.id)).toEqual(['a', 'c'])
    expect(team.bench).toHaveLength(3)
  })

  it('範囲外の削除は何もしない', () => {
    const team = makeTeam()
    team.bench = [makePlayer('a')]

    expect(removeBenchPlayer(team, -1)).toBe(team)
    expect(removeBenchPlayer(team, 9)).toBe(team)
    expect(removeBenchPlayer(team, 1.5)).toBe(team)
  })
})

describe('createRng の再現性', () => {
  it('同じシードなら同じ系列を返す', () => {
    const a = createRng(123)
    const b = createRng(123)
    const seqA = Array.from({ length: 10 }, () => a.next())
    const seqB = Array.from({ length: 10 }, () => b.next())
    expect(seqA).toEqual(seqB)
  })
})
