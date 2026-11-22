import { describe, expect, it } from 'vitest'
import {
  COURSES,
  COURSE_BY_ID,
  PITCH_TYPES,
  PITCH_TYPE_BY_ID,
  autoPlayLiveGame,
  chooseAiBattingAction,
  chooseAiPitch,
  courseLabel,
  createLiveGame,
  currentBatter,
  currentPitcher,
  currentTurnSide,
  effectiveBattingHand,
  makePitch,
  pitchIsStrike,
  pitchLabel,
  playerIsBatting,
  resolveLivePitch,
  submitBatting,
  submitPitch,
} from '../../src/game/liveGame.js'
import { buildFielders } from '../../src/game/simulate.js'
import { createRng } from '../../src/game/rng.js'
import { randomTeam } from '../../src/data/rosterFactory.js'

const home = randomTeam({ name: 'ホーム', seed: 11 })
const away = randomTeam({ name: 'アウェイ', seed: 12 })

function newGame(seed = 1, playerSide = 'home') {
  const rng = createRng(seed)
  return {
    rng,
    state: createLiveGame({ homeTeam: home, awayTeam: away, playerSide, rng }),
  }
}

/** 表の攻撃が終わるまで投げ続ける */
function pitchUntilBatting(state, rng) {
  let guard = 0
  while (state.phase === 'pitch' && guard < 500) {
    guard += 1
    const pitch = chooseAiPitch(currentPitcher(state), rng, {
      balls: state.balls,
      strikes: state.strikes,
    })
    submitPitch(state, pitch, rng)
  }
  return guard
}

describe('球種とコース', () => {
  it('4 球種と 9 コースが定義されている', () => {
    expect(PITCH_TYPES).toHaveLength(4)
    expect(COURSES).toHaveLength(9)
    expect(Object.keys(PITCH_TYPE_BY_ID).sort()).toEqual(
      ['changeup', 'curve', 'slider', 'straight'].sort(),
    )
    expect(Object.keys(COURSE_BY_ID)).toHaveLength(9)
  })

  it('中央の行と列がストライクゾーンになる', () => {
    expect(COURSE_BY_ID['middle-center'].inZone).toBe(true)
    expect(COURSE_BY_ID['middle-out'].inZone).toBe(true)
    expect(COURSE_BY_ID['high-center'].inZone).toBe(true)
    expect(COURSE_BY_ID['high-out'].inZone).toBe(false)
    expect(COURSE_BY_ID['low-in'].inZone).toBe(false)
  })

  it('makePitch は球種とコースを解決する', () => {
    const pitch = makePitch('slider', 'low-out')
    expect(pitch.type.label).toBe('スライダー')
    expect(pitch.course.label).toBe('低め外角')
    expect(pitchLabel(pitch)).toBe('スライダー 低め外角')
  })

  it('未知の球種・コースは例外になる', () => {
    expect(() => makePitch('fork', 'low-out')).toThrow(RangeError)
    expect(() => makePitch('straight', 'moon')).toThrow(RangeError)
  })

  it('chooseAiPitch は有効な投球を返す', () => {
    const rng = createRng(5)
    const pitcher = currentPitcher(newGame(1).state)
    for (let i = 0; i < 100; i += 1) {
      const pitch = chooseAiPitch(pitcher, rng)
      expect(PITCH_TYPE_BY_ID[pitch.type.id]).toBeTruthy()
      expect(COURSE_BY_ID[pitch.course.id]).toBeTruthy()
    }
  })
})

describe('左右打者の内外角', () => {
  const rightBatter = { bats: 'right' }
  const leftBatter = { bats: 'left' }
  const switchBatter = { bats: 'switch' }
  const rightPitcher = { throws: 'right' }
  const leftPitcher = { throws: 'left' }

  it('右打者は内角・外角をそのまま表示する', () => {
    expect(courseLabel(COURSE_BY_ID['middle-in'], rightBatter, rightPitcher)).toBe('真ん中内角')
    expect(courseLabel(COURSE_BY_ID['high-out'], rightBatter, leftPitcher)).toBe('高め外角')
  })

  it('左打者では内角と外角が入れ替わる', () => {
    expect(courseLabel(COURSE_BY_ID['middle-in'], leftBatter, rightPitcher)).toBe('真ん中外角')
    expect(courseLabel(COURSE_BY_ID['high-out'], leftBatter, rightPitcher)).toBe('高め内角')
  })

  it('スイッチヒッターは投手と反対の打席に立つ', () => {
    expect(effectiveBattingHand(switchBatter, rightPitcher)).toBe('left')
    expect(effectiveBattingHand(switchBatter, leftPitcher)).toBe('right')
    expect(courseLabel(COURSE_BY_ID['middle-in'], switchBatter, rightPitcher)).toBe('真ん中外角')
    expect(courseLabel(COURSE_BY_ID['middle-in'], switchBatter, leftPitcher)).toBe('真ん中内角')
  })

  it('pitchLabel も打者視点のコース名になる', () => {
    const pitch = makePitch('straight', 'high-out')
    expect(pitchLabel(pitch)).toBe('ストレート 高め外角')
    expect(pitchLabel(pitch, { batter: leftBatter, pitcher: rightPitcher })).toBe(
      'ストレート 高め内角',
    )
  })
})

describe('操作の精度', () => {
  const batter = {
    abilities: { contact: 50, power: 50, speed: 50, approach: 50 },
    bats: 'right',
  }
  const pitcher = {
    abilities: { velocity: 50, control: 50, breaking: 50, stamina: 50 },
    throws: 'right',
  }
  const fielders = buildFielders(home)
  const pitch = makePitch('straight', 'middle-center')

  it('リリース精度が高いほどストライクが増える', () => {
    const sample = (releaseQuality) => {
      const rng = createRng(100)
      let strikes = 0
      for (let i = 0; i < 4000; i += 1) {
        if (pitchIsStrike({ pitcher, pitch, rng, releaseQuality })) strikes += 1
      }
      return strikes
    }

    expect(sample(1)).toBeGreaterThan(sample(0))
  })

  it('タイミングとカーソルが合うほど打球になる確率が上がる', () => {
    const sample = (timingQuality, cursorMatch) => {
      const rng = createRng(200)
      let inPlay = 0
      for (let i = 0; i < 3000; i += 1) {
        const result = resolveLivePitch({
          batter,
          pitcher,
          fielders,
          pitch,
          action: 'contact',
          rng,
          timingQuality,
          cursorMatch,
        })
        if (result.kind === 'inplay') inPlay += 1
      }
      return inPlay
    }

    expect(sample(1, true)).toBeGreaterThan(sample(0, false))
  })

  it('投球結果に球種・コース・リリース精度が残る', () => {
    const { state, rng } = newGame()
    submitPitch(state, { typeId: 'slider', courseId: 'low-out', releaseQuality: 0.82 }, rng)

    expect(state.lastPitch.typeId).toBe('slider')
    expect(state.lastPitch.courseId).toBe('low-out')
    expect(state.lastPitch.releaseQuality).toBeCloseTo(0.82)
  })

  it('二人プレイでも投手のリリース精度が打席結果に引き継がれる', () => {
    const rng = createRng(22)
    const state = createLiveGame({ homeTeam: home, awayTeam: away, mode: 'two-player', rng })
    submitPitch(state, { typeId: 'curve', courseId: 'middle-out', releaseQuality: 0.2 }, rng)

    expect(state.currentPitchQuality).toBeCloseTo(0.2)
    submitBatting(state, 'take', rng)
    expect(state.lastPitch.releaseQuality).toBeCloseTo(0.2)
  })
})

describe('投球判定', () => {
  it('制球が高い投手ほどゾーン内に決まる', () => {
    const inZone = COURSE_BY_ID['middle-center']
    const outZone = COURSE_BY_ID['high-out']
    const pitch = { type: PITCH_TYPE_BY_ID.straight, course: inZone }
    const outPitch = { type: PITCH_TYPE_BY_ID.straight, course: outZone }

    const countStrikes = (control, target) => {
      const rng = createRng(99)
      const pitcher = { abilities: { control, velocity: 50, breaking: 50 } }
      let strikes = 0
      for (let i = 0; i < 4000; i += 1) {
        if (pitchIsStrike({ pitcher, pitch: target, rng })) strikes += 1
      }
      return strikes
    }

    expect(countStrikes(95, pitch)).toBeGreaterThan(countStrikes(20, pitch))
    expect(countStrikes(95, outPitch)).toBeLessThan(countStrikes(20, outPitch))
  })

  it('AI 打者はゾーン外の球を見送りやすい', () => {
    const rng = createRng(21)
    const batter = { abilities: { approach: 60, contact: 50 } }
    const inZone = { type: PITCH_TYPE_BY_ID.straight, course: COURSE_BY_ID['middle-center'] }
    const outZone = { type: PITCH_TYPE_BY_ID.straight, course: COURSE_BY_ID['high-out'] }

    let inSwings = 0
    let outSwings = 0
    for (let i = 0; i < 2000; i += 1) {
      if (
        chooseAiBattingAction({
          batter,
          pitch: inZone,
          count: { balls: 0, strikes: 0 },
          rng,
        }) !== 'take'
      ) {
        inSwings += 1
      }
      if (
        chooseAiBattingAction({
          batter,
          pitch: outZone,
          count: { balls: 0, strikes: 0 },
          rng,
        }) !== 'take'
      ) {
        outSwings += 1
      }
    }

    expect(inSwings).toBeGreaterThan(outSwings)
  })
})

describe('試合の進行', () => {
  it('開始時は 1 回表で、ホーム担当なら守備から始まる', () => {
    const { state } = newGame()
    expect(state.inning).toBe(1)
    expect(state.isTopHalf).toBe(true)
    expect(state.phase).toBe('pitch')
    expect(playerIsBatting(state)).toBe(false)
    expect(state.outs).toBe(0)
    expect(state.balls).toBe(0)
    expect(state.strikes).toBe(0)
  })

  it('アウェイ担当なら 1 回表から打席操作になる', () => {
    const { state } = newGame(1, 'away')
    expect(state.phase).toBe('bat')
    expect(playerIsBatting(state)).toBe(true)
    expect(state.currentPitch).not.toBeNull()
  })

  it('投球するとログとカウントが更新される', () => {
    const { state, rng } = newGame()
    submitPitch(state, { typeId: 'straight', courseId: 'middle-center' }, rng)

    expect(state.log).toHaveLength(1)
    expect(state.lastPitch).not.toBeNull()
    expect(state.lastPitch.text).toBeTruthy()
    expect(state.phase).toBe('pitch')
    expect(state.inning).toBe(1)
  })

  it('表が終わると裏の打席操作に切り替わる', () => {
    const { state, rng } = newGame()
    const pitches = pitchUntilBatting(state, rng)

    expect(state.inning).toBe(1)
    expect(state.isTopHalf).toBe(false)
    expect(state.phase).toBe('bat')
    expect(state.outs).toBe(0)
    expect(state.balls).toBe(0)
    expect(state.strikes).toBe(0)
    expect(state.currentPitch).not.toBeNull()
    expect(pitches).toBeGreaterThan(0)
  })

  it('打席操作でボール・ストライク・打球のいずれかが記録される', () => {
    const { state, rng } = newGame(1, 'away')
    submitBatting(state, 'contact', rng)

    expect(state.log).toHaveLength(1)
    expect(state.lastPitch.batter).toBeTruthy()
    expect(state.lastPitch.pitch).toContain(' ')
  })

  it('見送り・ミート・強振のすべてが動く', () => {
    for (const action of ['take', 'contact', 'power']) {
      const { state, rng } = newGame(3, 'away')
      expect(() => submitBatting(state, action, rng)).not.toThrow()
      expect(state.log).toHaveLength(1)
    }
  })

  it('投球中に打席操作はできない', () => {
    const { state, rng } = newGame()
    expect(state.phase).toBe('pitch')
    expect(() => submitBatting(state, 'take', rng)).toThrow()
  })

  it('打席中に投球操作はできない', () => {
    const { state, rng } = newGame(1, 'away')
    expect(state.phase).toBe('bat')
    expect(() =>
      submitPitch(state, { typeId: 'straight', courseId: 'middle-center' }, rng),
    ).toThrow()
  })

  it('未知の打撃操作・コースは拒否される', () => {
    const { state, rng } = newGame(1, 'away')
    expect(() => submitBatting(state, 'bunt', rng)).toThrow(RangeError)

    const pitching = newGame().state
    expect(() => submitPitch(pitching, { typeId: 'straight', courseId: 'moon' }, rng)).toThrow(
      RangeError,
    )
  })

  it('現在の打者と投手を取得できる', () => {
    const { state } = newGame()
    const batter = currentBatter(state)
    const pitcher = currentPitcher(state)

    expect(batter.name).toBeTruthy()
    expect(pitcher.isPitcher).toBe(true)
    expect(home.starters.some((slot) => slot.player.id === pitcher.id)).toBe(true)
  })
})

describe('二人プレイ', () => {
  it('投手が球を選ぶと打席フェーズになり、打者が選ぶと 1 球確定する', () => {
    const rng = createRng(9)
    const state = createLiveGame({ homeTeam: home, awayTeam: away, mode: 'two-player', rng })

    expect(state.mode).toBe('two-player')
    expect(state.phase).toBe('pitch')
    expect(currentTurnSide(state)).toBe('home')

    submitPitch(state, { typeId: 'slider', courseId: 'low-out' }, rng)
    expect(state.phase).toBe('bat')
    expect(state.currentPitch).not.toBeNull()
    expect(state.currentPitch.type.id).toBe('slider')
    expect(state.log).toHaveLength(0)
    expect(currentTurnSide(state)).toBe('away')

    submitBatting(state, 'contact', rng)
    expect(state.phase).toBe('pitch')
    expect(state.log).toHaveLength(1)
    expect(state.currentPitch).toBeNull()
    expect(currentTurnSide(state)).toBe('home')
  })

  it('守備側と攻撃側の両方が操作できる', () => {
    const rng = createRng(15)
    const state = createLiveGame({ homeTeam: home, awayTeam: away, mode: 'two-player', rng })

    // 1 回表: ホームが投げ、アウェイが打つ
    submitPitch(state, { typeId: 'straight', courseId: 'middle-center' }, rng)
    expect(currentTurnSide(state)).toBe('away')
    submitBatting(state, 'take', rng)

    // 表が終わるまで進める
    let guard = 0
    while (state.isTopHalf && !state.finished && guard < 500) {
      guard += 1
      if (state.phase === 'pitch') {
        submitPitch(state, { typeId: 'curve', courseId: 'low-center' }, rng)
      } else {
        submitBatting(state, 'contact', rng)
      }
    }

    expect(state.finished).toBe(false)
    expect(state.isTopHalf).toBe(false)
    expect(state.phase).toBe('pitch')
    expect(currentTurnSide(state)).toBe('away')
    expect(state.outs).toBe(0)
  })

  it('二人プレイでも自動進行で 9 回以内に終わる', () => {
    for (let seed = 0; seed < 10; seed += 1) {
      const rng = createRng(seed + 300)
      const state = createLiveGame({ homeTeam: home, awayTeam: away, mode: 'two-player', rng })
      autoPlayLiveGame(state, rng)

      expect(state.finished).toBe(true)
      expect(state.inning).toBeLessThanOrEqual(9)
      expect(state.phase).toBe('finished')
    }
  })
})

describe('自動進行', () => {
  it('必ず 9 回以内に終了する', () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const { state, rng } = newGame(seed)
      autoPlayLiveGame(state, rng)

      expect(state.finished, `seed ${seed}`).toBe(true)
      expect(state.phase).toBe('finished')
      expect(state.inning).toBeLessThanOrEqual(9)
      expect(state.inning).toBeGreaterThanOrEqual(1)
    }
  })

  it('回別スコアの合計が総得点と一致する', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      const { state, rng } = newGame(seed + 100)
      autoPlayLiveGame(state, rng)

      const homeSum = state.linescore.home.reduce((sum, value) => sum + (value ?? 0), 0)
      const awaySum = state.linescore.away.reduce((sum, value) => sum + (value ?? 0), 0)

      expect(homeSum).toBe(state.score.home)
      expect(awaySum).toBe(state.score.away)
      expect(state.score.home + state.score.away).toBeLessThan(40)
    }
  })

  it('同じシードなら同じ試合になる', () => {
    const a = newGame(777)
    const b = newGame(777)
    autoPlayLiveGame(a.state, a.rng)
    autoPlayLiveGame(b.state, b.rng)

    expect(a.state.score).toEqual(b.state.score)
    expect(a.state.log.length).toBe(b.state.log.length)
    expect(a.state.plays.map((play) => play.outcome)).toEqual(
      b.state.plays.map((play) => play.outcome),
    )
  })

  it('プレーログと打席数が現実的な範囲に収まる', () => {
    const { state, rng } = newGame(42)
    autoPlayLiveGame(state, rng)

    expect(state.log.length).toBeGreaterThan(100)
    expect(state.log.length).toBeLessThan(600)
    expect(state.plays.length).toBeGreaterThan(30)
    expect(state.plays.length).toBeLessThan(120)
    for (const play of state.plays) {
      expect(play.batter).toBeTruthy()
      expect(play.text).toBeTruthy()
    }
  })

  it('終了後は操作できない', () => {
    const { state, rng } = newGame(5)
    autoPlayLiveGame(state, rng)

    expect(() =>
      submitPitch(state, { typeId: 'straight', courseId: 'middle-center' }, rng),
    ).toThrow()
    expect(() => submitBatting(state, 'take', rng)).toThrow()
  })
})
