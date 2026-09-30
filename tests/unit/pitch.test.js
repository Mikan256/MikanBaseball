import { describe, expect, it } from 'vitest'
import { createInitialState } from '../../src/game/gameState.js'
import {
  HIT_DISTRIBUTION,
  PITCHES,
  PITCH_BY_ID,
  PITCH_PROBABILITIES,
  throwPitch,
} from '../../src/game/pitch.js'

const teams = {
  home: { name: 'ホーム', color: '#000', lineup: [{ name: 'H1', number: 1, power: 0.5 }] },
  away: { name: 'アウェイ', color: '#111', lineup: [{ name: 'A1', number: 1, power: 0.5 }] },
}

const newState = (seed = 12345) => createInitialState({ ...teams, rngSeed: seed })

describe('投球データ', () => {
  it('4 球種が定義され id で引ける', () => {
    expect(PITCHES).toHaveLength(4)
    for (const pitch of PITCHES) {
      expect(PITCH_BY_ID[pitch.id]).toBe(pitch)
      expect(pitch.label).toBeTruthy()
      expect(pitch.speed).toBeGreaterThan(0)
    }
  })

  it('各球種の結果確率の合計が 1 になる', () => {
    for (const pitch of PITCHES) {
      const probs = PITCH_PROBABILITIES[pitch.id]
      const total = Object.values(probs).reduce((sum, value) => sum + value, 0)
      expect(total).toBeCloseTo(1, 6)
    }
  })

  it('打球分布の重みの合計が 1 になる', () => {
    const total = HIT_DISTRIBUTION.reduce((sum, hit) => sum + hit.weight, 0)
    expect(total).toBeCloseTo(1, 6)
  })
})

describe('throwPitch', () => {
  it('未知の球種ではエラーになる', () => {
    expect(() => throwPitch(newState(), 'knuckle')).toThrow(/未知の球種/)
  })

  it('投球ごとに必ずテキストと結果を返す', () => {
    const state = newState()
    const result = throwPitch(state, 'straight')

    expect(result.text).toContain('ストレート')
    expect(['ball', 'foul', 'hit', 'strike']).toContain(result.outcome)
  })

  it('投球するとログに記録される', () => {
    const state = newState()
    expect(state.log).toHaveLength(0)

    throwPitch(state, 'curve')

    expect(state.log).toHaveLength(1)
    expect(state.log[0].inning).toBe('1回 表')
  })

  it('同じシードなら同じ結果列になる（再現性）', () => {
    const run = () => {
      const state = newState(999)
      const results = []
      for (let i = 0; i < 20; i += 1) results.push(throwPitch(state, 'straight').outcome)
      return results
    }

    expect(run()).toEqual(run())
  })

  it('シードが変わると結果列も変わる', () => {
    const run = (seed) => {
      const state = newState(seed)
      const results = []
      for (let i = 0; i < 20; i += 1) results.push(throwPitch(state, 'straight').outcome)
      return results
    }

    expect(run(1)).not.toEqual(run(2))
  })

  it('進行してもボール・ストライク・アウトは範囲内に収まる', () => {
    const state = newState(7)
    for (let i = 0; i < 200; i += 1) {
      throwPitch(state, 'slider')
      expect(state.balls).toBeLessThan(4)
      expect(state.strikes).toBeLessThan(3)
      expect(state.outs).toBeLessThanOrEqual(3)
    }
  })

  it('投球のたびにシードが進む', () => {
    const state = newState()
    const seedBefore = state.rngSeed
    throwPitch(state, 'straight')
    expect(state.rngSeed).not.toBe(seedBefore)
  })
})
