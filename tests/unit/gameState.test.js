import { describe, expect, it } from 'vitest'
import {
  advanceRunners,
  applyBall,
  applyFoul,
  applyHit,
  applyOut,
  applyStrike,
  closeHalfInning,
  createInitialState,
  inningLabel,
  isGameOver,
  offenseKey,
  winnerKey,
} from '../../src/game/gameState.js'
import { OUTS_PER_HALF_INNING, INNINGS } from '../../src/game/constants.js'

const teams = {
  home: { name: 'ホーム', color: '#000', lineup: [{ name: 'H1', number: 1, power: 0.5 }] },
  away: { name: 'アウェイ', color: '#111', lineup: [{ name: 'A1', number: 1, power: 0.5 }] },
}

const newState = () => createInitialState({ ...teams, rngSeed: 42 })

describe('createInitialState', () => {
  it('1 回表・0 アウト・0 球 0 ストライクで始まる', () => {
    const state = newState()
    expect(state.inning).toBe(1)
    expect(state.isTopHalf).toBe(true)
    expect(state.outs).toBe(0)
    expect(state.balls).toBe(0)
    expect(state.strikes).toBe(0)
    expect(state.runners).toEqual([null, null, null])
    expect(state.finished).toBe(false)
  })

  it('既定値でもクラッシュせずに初期状態を作れる', () => {
    expect(() => createInitialState()).not.toThrow()
  })
})

describe('offenseKey', () => {
  it('表ならアウェイ、裡ならホームが攻撃する', () => {
    const state = newState()
    expect(offenseKey(state)).toBe('away')
    state.isTopHalf = false
    expect(offenseKey(state)).toBe('home')
  })
})

describe('advanceRunners', () => {
  const runner = (name) => ({ name })

  it('走者がいなければ誰も進まない', () => {
    const result = advanceRunners([null, null, null], 2)
    expect(result.runners).toEqual([null, null, null])
    expect(result.scored).toBe(0)
  })

  it('単打ならランナーは 1 つ進捗する', () => {
    const result = advanceRunners([runner('A'), null, null], 1)
    expect(result.runners[1].name).toBe('A')
    expect(result.scored).toBe(0)
  })

  it('二塁打で一塁の走者は三塁へ進む（得点は入らない）', () => {
    const result = advanceRunners([runner('A'), null, null], 2)
    expect(result.scored).toBe(0)
    expect(result.runners[2].name).toBe('A')
  })

  it('二塁打で一・二塁の走者がいれば 1 点入る', () => {
    const result = advanceRunners([runner('A'), runner('B'), null], 2)
    expect(result.scored).toBe(1)
    expect(result.runners[2].name).toBe('A')
  })

  it('ホームランでは満塁なら 3 点が選んでくる', () => {
    const result = advanceRunners([runner('A'), runner('B'), runner('C')], 4)
    expect(result.scored).toBe(3)
    expect(result.runners).toEqual([null, null, null])
  })

  it('元の配列を変更しない（純粋関数）', () => {
    const runners = [runner('A'), null, null]
    advanceRunners(runners, 3)
    expect(runners[0].name).toBe('A')
  })
})

describe('applyHit', () => {
  it('ヒットで打者が一塁に入り、打席はリセットされる', () => {
    const state = newState()
    state.strikes = 2
    const result = applyHit(state, 1)

    expect(result.scored).toBe(0)
    expect(state.runners[0].name).toBe('A1')
    expect(state.strikes).toBe(0)
    expect(state.balls).toBe(0)
  })

  it('得点はスコアボードと回別表の両方に反映される', () => {
    const state = newState()
    state.runners = [{ name: 'R1' }, null, null]
    applyHit(state, 3)

    expect(state.score.away).toBe(1)
    expect(state.linescore.away[0]).toBe(1)
  })
})

describe('applyBall / applyStrike', () => {
  it('4 球目のボールで四球になり打者在審する', () => {
    const state = newState()
    state.balls = 3
    const result = applyBall(state)

    expect(result.walk).toBe(true)
    expect(state.balls).toBe(0)
    expect(state.runners[0].name).toBe('A1')
  })

  it('ストライクを取るとボールは 0 に戻る', () => {
    const state = newState()
    state.balls = 2
    applyStrike(state)

    expect(state.strikes).toBe(1)
    expect(state.balls).toBe(0)
  })

  it('3 ストライクで三振となりアウトが増える', () => {
    const state = newState()
    state.strikes = 2
    const result = applyStrike(state)

    expect(result.strikeout).toBe(true)
    expect(state.outs).toBe(1)
  })
})

describe('applyFoul', () => {
  it('ファウルでもストライクは増える', () => {
    const state = newState()
    state.strikes = 0
    applyFoul(state)
    expect(state.strikes).toBe(1)
  })

  it('2 ストライク時のファウルでも三振にはならない', () => {
    const state = newState()
    state.strikes = 2
    applyFoul(state)

    expect(state.strikes).toBe(2)
    expect(state.outs).toBe(0)
  })
})

describe('表裏の交代', () => {
  it('3 OUT で自動的に裡へ回り、打席と走者がリセットされる', () => {
    const state = newState()
    state.runners = [{ name: 'R1' }, null, null]
    state.balls = 3
    state.batterIndex = 4

    for (let i = 0; i < OUTS_PER_HALF_INNING; i += 1) applyOut(state)

    expect(state.isTopHalf).toBe(false)
    expect(state.outs).toBe(0)
    expect(state.runners).toEqual([null, null, null])
    expect(state.batterIndex).toBe(0)
  })

  it('closeHalfInning で回が進む', () => {
    const state = newState()
    state.isTopHalf = false
    closeHalfInning(state)

    expect(state.isTopHalf).toBe(true)
    expect(state.inning).toBe(2)
  })

  it('9 回裏が終われば試合終了になる', () => {
    const state = newState()
    state.inning = INNINGS
    state.isTopHalf = false
    closeHalfInning(state)

    expect(state.finished).toBe(true)
    expect(isGameOver(state)).toBe(true)
  })
})

describe('winnerKey', () => {
  it('試合終了前は null', () => {
    expect(winnerKey(newState())).toBeNull()
  })

  it('得点が多い側が勝つ', () => {
    const state = newState()
    state.finished = true
    state.score.home = 3
    expect(winnerKey(state)).toBe('home')
  })

  it('同点なら引き分けとして null', () => {
    const state = newState()
    state.finished = true
    state.score.home = 2
    state.score.away = 2
    expect(winnerKey(state)).toBeNull()
  })
})

describe('inningLabel', () => {
  it('回と表裡を日本語で返す', () => {
    const state = newState()
    expect(inningLabel(state)).toBe('1回 表')
    state.isTopHalf = false
    expect(inningLabel(state)).toBe('1回 裏')
  })
})
