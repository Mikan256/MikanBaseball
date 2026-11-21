import { describe, expect, it } from 'vitest'
import { OUTCOME, basesFor, simulateGame } from '../../src/game/simulate.js'
import { advanceOnWalk, advanceRunners } from '../../src/game/runners.js'
import { randomTeam } from '../../src/data/rosterFactory.js'

/** 走者を指定した状態の配列を作る */
const runners = (...names) => names.map((name) => (name ? { name } : null))

/** テスト用のシード付き乱数（mulberry32 と同じ動き） */
function seededRng(seed) {
  let value = seed >>> 0
  const next = () => {
    value = (value + 0x6d2b79f5) >>> 0
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    next,
    weighted(items, weightOf) {
      const total = items.reduce((sum, item) => sum + weightOf(item), 0)
      let threshold = next() * total
      for (const item of items) {
        threshold -= weightOf(item)
        if (threshold < 0) return item
      }
      return items[items.length - 1]
    },
  }
}

describe('安打時の進塁と得点', () => {
  it('満塁ホームランで走者 3 人が得点する（打者は別に加算）', () => {
    const { runners: next, scored } = advanceRunners(runners('A', 'B', 'C'), 4)
    expect(scored).toBe(3)
    expect(next).toEqual([null, null, null])
  })

  it('一・二塁に走者がいての二塁打で 1 点が上がる（二塁走者が生還）', () => {
    const { scored, runners: next } = advanceRunners(runners('A', 'B', null), 2)
    expect(scored).toBe(1)
    expect(next[2].name).toBe('A')
    expect(next[1]).toBeNull()
  })

  it('満塁の単打で 1 点（3 塁走者）が入る', () => {
    const { scored, runners: next } = advanceRunners(runners('A', 'B', 'C'), 1)
    expect(scored).toBe(1)
    expect(next[2].name).toBe('B')
    expect(next[1].name).toBe('A')
  })

  it('二塁打で満塁なら 2 点が上がる', () => {
    const { scored } = advanceRunners(runners('A', 'B', 'C'), 2)
    expect(scored).toBe(2)
  })

  it('無走者のホームランでは既存の走者が得点しない（打者のみ）', () => {
    const { scored } = advanceRunners(runners(null, null, null), 4)
    expect(scored).toBe(0)
  })

  it('三塁安打なら走者が全員得点する', () => {
    const { scored } = advanceRunners(runners('A', 'B', 'C'), 3)
    expect(scored).toBe(3)
  })
})

describe('四球の進塁', () => {
  it('一塁が空いていれば打者だけが一塁へ入る', () => {
    const { runners: next, scored } = advanceOnWalk(runners(null, 'B', 'C'))
    expect(scored).toBe(0)
    expect(next[0]).toBeNull()
    expect(next[1].name).toBe('B')
    expect(next[2].name).toBe('C')
  })

  it('一塁走者は二塁へ押し出される', () => {
    const { runners: next, scored } = advanceOnWalk(runners('A', null, 'C'))
    expect(scored).toBe(0)
    expect(next[0]).toBeNull()
    expect(next[1].name).toBe('A')
    expect(next[2].name).toBe('C')
  })

  it('満塁なら三塁走者が生還する', () => {
    const { runners: next, scored } = advanceOnWalk(runners('A', 'B', 'C'))
    expect(scored).toBe(1)
    expect(next[0]).toBeNull()
    expect(next[1].name).toBe('A')
    expect(next[2].name).toBe('B')
  })
})

describe('basesFor', () => {
  it('安打の種類に対応する進塁数を返す', () => {
    expect(basesFor(OUTCOME.SINGLE)).toBe(1)
    expect(basesFor(OUTCOME.DOUBLE)).toBe(2)
    expect(basesFor(OUTCOME.TRIPLE)).toBe(3)
    expect(basesFor(OUTCOME.HOMERUN)).toBe(4)
  })

  it('アウトは 0 塁（走者は動かない）', () => {
    for (const outcome of [OUTCOME.FLYOUT, OUTCOME.GROUNDOUT, OUTCOME.LINEOUT, OUTCOME.STRIKEOUT]) {
      expect(basesFor(outcome)).toBe(0)
    }
  })
})

describe('1 試合の得点の一貫性', () => {
  const home = randomTeam({ name: 'ホーム', seed: 101 })
  const away = randomTeam({ name: 'アウェイ', seed: 102 })

  it('回別スコアの合計と総合スコアが一致する', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const state = simulateGame({ homeTeam: home, awayTeam: away, rng: seededRng(seed) })

      const sum = [...state.linescore.home, ...state.linescore.away].reduce(
        (acc, value) => acc + (value ?? 0),
        0,
      )
      expect(sum).toBe(state.score.home + state.score.away)
    }
  })

  it('1 試合の合計得点が現実的な範囲に収まる', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const state = simulateGame({ homeTeam: home, awayTeam: away, rng: seededRng(seed) })
      const total = state.score.home + state.score.away

      // 高校野球では 0〜20 点程度。大きく外れれば加算バグの疑いがある
      expect(total).toBeGreaterThanOrEqual(0)
      expect(total).toBeLessThanOrEqual(30)
    }
  })

  it('1 試合の打席数は 50〜400 程度', () => {
    for (const seed of [1, 2, 3]) {
      const state = simulateGame({ homeTeam: home, awayTeam: away, rng: seededRng(seed) })
      expect(state.plays.length).toBeGreaterThan(50)
      expect(state.plays.length).toBeLessThan(400)
    }
  })

  it('回別スコア表は 9 回ぶんを超えない', () => {
    const state = simulateGame({ homeTeam: home, awayTeam: away, rng: seededRng(9) })
    expect(state.linescore.home.length).toBeLessThanOrEqual(9)
    expect(state.linescore.away.length).toBeLessThanOrEqual(9)
  })

  it('9 回で必ず終了する', () => {
    for (const seed of [1, 7, 13, 21]) {
      const state = simulateGame({ homeTeam: home, awayTeam: away, rng: seededRng(seed) })
      expect(state.finished).toBe(true)
      expect(state.inning).toBe(10)
    }
  })
})
