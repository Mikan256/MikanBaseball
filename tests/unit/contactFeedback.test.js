import { describe, expect, it } from 'vitest'
import {
  PITCH_TYPES,
  PITCH_TYPE_BY_ID,
  createLiveGame,
  pitchFlightMs,
  submitBatting,
  submitPitch,
} from '../../src/game/liveGame.js'
import { createRng } from '../../src/game/rng.js'
import { randomTeam } from '../../src/data/rosterFactory.js'

const home = randomTeam({ name: 'ホーム', seed: 21 })
const away = randomTeam({ name: 'アウェイ', seed: 22 })

function newGame(seed, playerSide = 'home', mode = 'solo') {
  const rng = createRng(seed)
  return { rng, state: createLiveGame({ homeTeam: home, awayTeam: away, playerSide, mode, rng }) }
}

/** 条件を満たす打席結果が出るまでシードを変えて試す（結果依存のテストにしない） */
function batUntil(seedBase, predicate, action = 'contact', options = {}) {
  for (let i = 0; i < 300; i += 1) {
    const { state, rng } = newGame(seedBase + i, 'away')
    submitBatting(state, action, rng, options)
    if (predicate(state.lastPitch)) return state.lastPitch
  }
  throw new Error('条件を満たす打球が見つかりませんでした')
}

const isSwingResult = (last) => last.kind !== 'strike'

describe('球種ごとの球速と飛行時間', () => {
  it('4 球種すべてに球速・飛行時間があり、ストレートが最速で最短', () => {
    const expected = {
      straight: { speedKmh: 147, flightMs: 480 },
      slider: { speedKmh: 136, flightMs: 550 },
      curve: { speedKmh: 118, flightMs: 650 },
      changeup: { speedKmh: 127, flightMs: 610 },
    }

    expect(PITCH_TYPES).toHaveLength(4)
    for (const type of PITCH_TYPES) {
      expect(type.speedKmh, type.id).toBe(expected[type.id].speedKmh)
      expect(type.flightMs, type.id).toBe(expected[type.id].flightMs)
      expect(pitchFlightMs(type.id), type.id).toBe(type.flightMs)
    }

    const fastest = PITCH_TYPES.reduce((a, b) => (a.speedKmh > b.speedKmh ? a : b))
    const shortest = PITCH_TYPES.reduce((a, b) => (a.flightMs < b.flightMs ? a : b))
    expect(fastest.id).toBe('straight')
    expect(shortest.id).toBe('straight')
  })

  it('未知の球種 ID はストレートの飛行時間にフォールバックする', () => {
    const fallback = PITCH_TYPE_BY_ID.straight.flightMs
    expect(pitchFlightMs('fork')).toBe(fallback)
    expect(pitchFlightMs(undefined)).toBe(fallback)
    expect(pitchFlightMs(null)).toBe(fallback)
  })
})

describe('投球の飛行時間を状態に残す', () => {
  it('打席フェーズの currentPitch に flightMs がある', () => {
    const { state } = newGame(1, 'away')
    expect(state.currentPitch).not.toBeNull()
    expect(state.currentPitch.flightMs).toBe(pitchFlightMs(state.currentPitch.type.id))
  })

  it('二人プレイの保留投球にも flightMs がある', () => {
    const { state, rng } = newGame(2, 'home', 'two-player')
    submitPitch(state, { typeId: 'curve', courseId: 'middle-out' }, rng)

    expect(state.currentPitch).not.toBeNull()
    expect(state.currentPitch.flightMs).toBe(pitchFlightMs('curve'))
  })

  it('いずれの結果でも lastPitch に flightMs と speedKmh が残る', () => {
    const seen = new Set()
    for (let seed = 0; seed < 300 && seen.size < 4; seed += 1) {
      for (const action of ['take', 'power']) {
        const { state, rng } = newGame(seed + 1000, 'away')
        submitBatting(state, action, rng, { timingQuality: 0.7, cursorMatch: true })

        const last = state.lastPitch
        expect(typeof last.flightMs).toBe('number')
        expect(last.flightMs).toBe(pitchFlightMs(last.typeId))
        expect(typeof last.speedKmh).toBe('number')
        expect(last.speedKmh).toBe(PITCH_TYPE_BY_ID[last.typeId].speedKmh)
        seen.add(last.kind)
      }
    }
    expect([...seen].sort()).toEqual(['ball', 'foul', 'inplay', 'strike'].sort())
  })

  it('打球になった 1 球にも flightMs が残る', () => {
    const last = batUntil(3000, isSwingResult, 'contact', {
      timingQuality: 1,
      cursorMatch: true,
    })
    expect(last.kind).toBe('inplay')
    expect(last.flightMs).toBe(pitchFlightMs(last.typeId))
  })
})

describe('接触フィードバック', () => {
  it('見送り・ミート・強振のすべてに contact が付く', () => {
    for (const action of ['take', 'contact', 'power']) {
      const { state, rng } = newGame(7, 'away')
      submitBatting(state, action, rng, {
        timingQuality: 0.9,
        cursorMatch: true,
        timingOffset: 0,
        cursorQuality: 0.95,
      })

      const contact = state.lastPitch.contact
      expect(contact, action).toBeTruthy()
      expect(['early', 'good', 'late']).toContain(contact.timing)
      expect(['match', 'near', 'miss']).toContain(contact.cursor)
      expect(contact.timingQuality).toBeGreaterThanOrEqual(0)
      expect(contact.timingQuality).toBeLessThanOrEqual(1)
      expect(typeof contact.cursorMatch).toBe('boolean')
      expect(contact.quality).toBeGreaterThanOrEqual(0)
      expect(contact.quality).toBeLessThanOrEqual(1)
      expect(typeof contact.label).toBe('string')
      // JSON 送信しても壊れないこと（Flaxia の状態圧縮でそのまま送られる）
      expect(JSON.parse(JSON.stringify(contact))).toEqual(contact)
    }
  })

  it('見送りは常に「見送り」、空振りは「空振り」になる', () => {
    const take = newGame(11, 'away')
    submitBatting(take.state, 'take', take.rng)
    expect(take.state.lastPitch.contact.label).toBe('見送り')

    const whiff = batUntil(4000, (last) => last.kind === 'strike', 'contact')
    expect(whiff.contact.label).toBe('空振り')
    expect(whiff.contact.cursor).toBe('miss')
  })

  it('タイミング精度とカーソル一致度が quality に反映される', () => {
    const best = batUntil(5000, isSwingResult, 'contact', {
      timingQuality: 1,
      cursorMatch: true,
    })
    const worst = batUntil(6000, isSwingResult, 'contact', {
      timingQuality: 0.1,
      cursorMatch: false,
      cursorQuality: 0,
    })

    expect(best.contact.cursor).toBe('match')
    expect(worst.contact.cursor).toBe('miss')
    expect(best.contact.quality).toBeGreaterThan(worst.contact.quality)
    expect(best.contact.label).toBe('ジャストミート')
  })

  it('カーソルが真ん中から少し外れると near になる', () => {
    const last = batUntil(7000, isSwingResult, 'contact', {
      timingQuality: 0.8,
      cursorMatch: false,
      cursorQuality: 0.7,
    })
    expect(last.contact.cursor).toBe('near')
  })

  it('早い・遅れ・打ち頃のラベルが出る', () => {
    const early = batUntil(8000, isSwingResult, 'contact', {
      timingQuality: 0.6,
      cursorMatch: false,
      timingOffset: -0.5,
    })
    expect(early.contact.timing).toBe('early')
    expect(early.contact.label).toBe('やや早い')

    const late = batUntil(9000, isSwingResult, 'contact', {
      timingQuality: 0.6,
      cursorMatch: false,
      timingOffset: 0.5,
    })
    expect(late.contact.timing).toBe('late')
    expect(late.contact.label).toBe('やや遅れ')

    const good = batUntil(10000, isSwingResult, 'contact', {
      timingQuality: 1,
      cursorMatch: false,
      cursorQuality: 0.2,
    })
    expect(good.contact.quality).toBeGreaterThanOrEqual(0.68)
    expect(good.contact.quality).toBeLessThan(0.9)
    expect(good.contact.label).toBe('打ち頃')
  })
})

describe('決定性', () => {
  it('同じシード・同じ操作ならログも接触情報も完全一致する', () => {
    const play = (seed) => {
      const { state, rng } = newGame(seed)
      let guard = 0
      while (!state.finished && guard < 5000) {
        guard += 1
        if (state.phase === 'pitch') {
          submitPitch(state, { typeId: 'curve', courseId: 'middle-out', releaseQuality: 0.7 }, rng)
        } else if (state.phase === 'bat') {
          submitBatting(state, 'contact', rng, {
            timingQuality: 0.8,
            cursorMatch: true,
            timingOffset: -0.05,
            cursorQuality: 0.9,
          })
        } else {
          break
        }
      }
      return state
    }

    const a = play(777)
    const b = play(777)
    expect(a.log).toEqual(b.log)
    expect(a.plays).toEqual(b.plays)
    expect(a.score).toEqual(b.score)
    expect(a.linescore).toEqual(b.linescore)
    expect(a.lastPitch).toEqual(b.lastPitch)
  })
})
