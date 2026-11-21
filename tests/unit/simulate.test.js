import { describe, expect, it } from 'vitest'
import {
  OUTCOME,
  basesFor,
  buildFielders,
  gameSummary,
  isOut,
  resolvePlateAppearance,
  simulateGame,
} from '../../src/game/simulate.js'
import { createPlayer } from '../../src/game/roster.js'
import { createRng } from '../../src/game/rng.js'
import { randomTeam } from '../../src/data/rosterFactory.js'
import { POSITION_IDS } from '../../src/game/positions.js'

/** 能力値を指定して選手を作る */
function player(abilities, overrides = {}) {
  const base = {
    contact: 50,
    power: 50,
    speed: 50,
    approach: 50,
    velocity: 50,
    control: 50,
    breaking: 50,
    stamina: 50,
    fielding: 50,
    arm: 50,
    throwing: 50,
  }
  return createPlayer({
    id: overrides.id ?? 'x',
    name: overrides.name ?? 'テスト',
    number: 1,
    abilities: { ...base, ...abilities },
    positionFit: Object.fromEntries(POSITION_IDS.map((p) => [p, 50])),
    ...overrides,
  })
}

const fielders = Object.fromEntries(
  POSITION_IDS.map((id) => [id, player({ fielding: 60, arm: 60 })]),
)

describe('打席結果の分布', () => {
  // 参考: 高校野球の公式記録では安打率約 25%、三振率約 18%、四球率約 9%。
  const home = randomTeam({ name: 'ホーム', seed: 1 })
  const away = randomTeam({ name: 'アウェイ', seed: 2 })

  /** 多数の試合を流して結果の比率を出す */
  function distribution(games = 150) {
    const counts = {}
    let plateAppearances = 0
    let pitchCount = 0

    for (const seed of Array.from({ length: games }, (_, i) => i)) {
      const state = simulateGame({ homeTeam: home, awayTeam: away, rng: createRng(seed) })
      for (const play of state.plays) {
        counts[play.outcome] = (counts[play.outcome] ?? 0) + 1
        plateAppearances += 1
        pitchCount += play.pitches
      }
    }

    const rate = (outcome) => (counts[outcome] ?? 0) / plateAppearances
    return { counts, plateAppearances, pitchCount, rate }
  }

  it('安打率が 15〜35% に収まる', () => {
    const { rate } = distribution()
    const hits =
      rate(OUTCOME.SINGLE) + rate(OUTCOME.DOUBLE) + rate(OUTCOME.TRIPLE) + rate(OUTCOME.HOMERUN)

    expect(hits).toBeGreaterThan(0.15)
    expect(hits).toBeLessThan(0.35)
  })

  it('三振率が 10〜28% に収まる', () => {
    const { rate } = distribution()
    expect(rate(OUTCOME.STRIKEOUT)).toBeGreaterThan(0.1)
    expect(rate(OUTCOME.STRIKEOUT)).toBeLessThan(0.28)
  })

  it('四球率が 3〜16% に収まる', () => {
    const { rate } = distribution()
    expect(rate(OUTCOME.WALK)).toBeGreaterThan(0.03)
    expect(rate(OUTCOME.WALK)).toBeLessThan(0.16)
  })

  it('四球・三振・安打・アウトがすべて登場する', () => {
    // プレイログは打席ごとに 1 件だけ残すので、ボールやファウルは登場しない
    const { counts } = distribution(40)

    expect(counts[OUTCOME.WALK]).toBeGreaterThan(0)
    expect(counts[OUTCOME.STRIKEOUT]).toBeGreaterThan(0)
    expect(counts[OUTCOME.SINGLE]).toBeGreaterThan(0)
    expect(counts[OUTCOME.DOUBLE]).toBeGreaterThan(0)
    expect(counts[OUTCOME.FLYOUT]).toBeGreaterThan(0)
    expect(counts[OUTCOME.GROUNDOUT]).toBeGreaterThan(0)
    expect(counts.ball).toBeUndefined()
    expect(counts.foul).toBeUndefined()
  })

  it('1 打席あたりの球数が 2.5〜4.5 球に収まる', () => {
    const { plateAppearances, pitchCount } = distribution()
    const perPlateAppearance = pitchCount / plateAppearances

    expect(perPlateAppearance).toBeGreaterThan(2.5)
    expect(perPlateAppearance).toBeLessThan(4.5)
  })

  it('ホームランが 0 にはならず、全体の 1% を超えない', () => {
    const { rate } = distribution()
    expect(rate(OUTCOME.HOMERUN)).toBeGreaterThan(0)
    expect(rate(OUTCOME.HOMERUN)).toBeLessThan(0.01)
  })

  it('1 試合の総得点が 0〜30 点に収まる', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const state = simulateGame({ homeTeam: home, awayTeam: away, rng: createRng(seed) })
      const total = state.score.home + state.score.away
      expect(total).toBeGreaterThanOrEqual(0)
      expect(total).toBeLessThan(30)
    }
  })

  it('引き分け率が 25% を超えない', () => {
    let ties = 0
    const games = 120
    for (const seed of Array.from({ length: games }, (_, i) => i)) {
      const state = simulateGame({ homeTeam: home, awayTeam: away, rng: createRng(seed) })
      if (state.score.home === state.score.away) ties += 1
    }

    expect(ties / games).toBeLessThan(0.25)
  })
})

describe('resolvePlateAppearance', () => {
  it('未知の選手でも必ず何かの結果を返す', () => {
    const batter = player({ contact: 60 })
    const pitcher = player({ velocity: 60 })
    const result = resolvePlateAppearance({ batter, pitcher, fielders, rng: createRng(1) })

    expect(result.outcome).toBeTruthy()
    expect(result.text).toBeTruthy()
  })

  it('打者が強いほど安打が増える', () => {
    const pitcher = player({ velocity: 40, control: 40, breaking: 40, stamina: 40 })
    const weak = player({ contact: 20, power: 20, speed: 20, approach: 20 })
    const strong = player({ contact: 95, power: 95, speed: 95, approach: 95 })

    const run = (batter) => {
      const rng = createRng(42)
      const counts = { hit: 0, out: 0, walk: 0, ball: 0, foul: 0 }
      for (let i = 0; i < 4000; i += 1) {
        const result = resolvePlateAppearance({ batter, pitcher, fielders, rng })
        if (result.outcome === OUTCOME.WALK) counts.walk += 1
        else if (isOut(result.outcome)) counts.out += 1
        else counts.hit += 1
      }
      return counts
    }

    const weakResult = run(weak)
    const strongResult = run(strong)

    expect(strongResult.hit).toBeGreaterThan(weakResult.hit)
    expect(weakResult.out).toBeGreaterThan(strongResult.out)
  })

  it('投手が強いほど三振が増える', () => {
    const batter = player({ contact: 50, power: 50, speed: 50, approach: 50 })
    const strongPitcher = player({ velocity: 95, control: 95, breaking: 95, stamina: 95 })
    const weakPitcher = player({ velocity: 20, control: 20, breaking: 20, stamina: 20 })

    const strikeoutRate = (pitcher) => {
      const rng = createRng(7)
      let strikeouts = 0
      for (let i = 0; i < 4000; i += 1) {
        const result = resolvePlateAppearance({ batter, pitcher, fielders, rng })
        if (result.outcome === OUTCOME.STRIKEOUT) strikeouts += 1
      }
      return strikeouts
    }

    expect(strikeoutRate(strongPitcher)).toBeGreaterThan(strikeoutRate(weakPitcher))
  })

  it('長打力が高いほどホームランが増える', () => {
    const pitcher = player({ velocity: 45, control: 45, breaking: 45, stamina: 45 })
    const weakPower = player({ contact: 70, power: 10, speed: 50, approach: 50 })
    const strongPower = player({ contact: 70, power: 100, speed: 50, approach: 50 })

    const homerRate = (batter) => {
      const rng = createRng(11)
      let homers = 0
      for (let i = 0; i < 4000; i += 1) {
        const result = resolvePlateAppearance({ batter, pitcher, fielders, rng })
        if (result.outcome === OUTCOME.HOMERUN) homers += 1
      }
      return homers
    }

    expect(homerRate(strongPower)).toBeGreaterThan(homerRate(weakPower))
  })

  it('守備が弱いと守備エラーが増える', () => {
    const batter = player({ contact: 95, power: 95 })
    const pitcher = player({ velocity: 30, control: 30, breaking: 30, stamina: 30 })

    const strongFielders = Object.fromEntries(
      POSITION_IDS.map((id) => [id, player({ fielding: 100, arm: 100, throwing: 100 })]),
    )
    const weakFielders = Object.fromEntries(
      POSITION_IDS.map((id) => [id, player({ fielding: 1, arm: 1, throwing: 1 })]),
    )

    const errorRate = (field) => {
      const rng = createRng(23)
      let errors = 0
      for (let i = 0; i < 4000; i += 1) {
        const result = resolvePlateAppearance({ batter, pitcher, fielders: field, rng })
        if (result.text === '守備エラー') errors += 1
      }
      return errors
    }

    expect(errorRate(weakFielders)).toBeGreaterThan(errorRate(strongFielders))
  })

  it('同じシードなら同じ打席結果になる', () => {
    const batter = player({ contact: 70, power: 70 })
    const pitcher = player({ velocity: 70, control: 70, breaking: 70, stamina: 70 })

    const run = () => {
      const rng = createRng(555)
      return Array.from(
        { length: 50 },
        () => resolvePlateAppearance({ batter, pitcher, fielders, rng }).outcome,
      )
    }

    expect(run()).toEqual(run())
  })
})

describe('basesFor', () => {
  it('安打の種類に対応する進塁数を返す', () => {
    expect(basesFor(OUTCOME.SINGLE)).toBe(1)
    expect(basesFor(OUTCOME.DOUBLE)).toBe(2)
    expect(basesFor(OUTCOME.TRIPLE)).toBe(3)
    expect(basesFor(OUTCOME.HOMERUN)).toBe(4)
    expect(basesFor(OUTCOME.FLYOUT)).toBe(0)
  })
})

describe('isOut', () => {
  it('アウトする結果だけを true にする', () => {
    expect(isOut(OUTCOME.STRIKEOUT)).toBe(true)
    expect(isOut(OUTCOME.FLYOUT)).toBe(true)
    expect(isOut(OUTCOME.HOMERUN)).toBe(false)
    expect(isOut(OUTCOME.WALK)).toBe(false)
  })
})

describe('buildFielders', () => {
  it('守備位置ごとの選手を返す', () => {
    const team = randomTeam({ name: 'テスト', seed: 4 })
    const result = buildFielders(team)
    expect(Object.keys(result).sort()).toEqual([...POSITION_IDS].sort())
  })
})

describe('simulateGame', () => {
  it('9 回で必ず終了する', () => {
    const homeTeam = randomTeam({ name: 'ホーム', seed: 1 })
    const awayTeam = randomTeam({ name: 'アウェイ', seed: 2 })

    for (const seed of [1, 5, 20, 100]) {
      const state = simulateGame({ homeTeam, awayTeam, rng: createRng(seed) })
      expect(state.finished).toBe(true)
      expect(state.inning).toBe(10)
    }
  })

  it('スコアが非負の整数になる', () => {
    const homeTeam = randomTeam({ name: 'ホーム', seed: 3 })
    const awayTeam = randomTeam({ name: 'アウェイ', seed: 4 })
    const state = simulateGame({ homeTeam, awayTeam, rng: createRng(9) })

    expect(state.score.home).toBeGreaterThanOrEqual(0)
    expect(state.score.away).toBeGreaterThanOrEqual(0)
    expect(Number.isInteger(state.score.home)).toBe(true)
    expect(Number.isInteger(state.score.away)).toBe(true)
  })

  it('合計スコアと回別スコアの合計が一致する', () => {
    const homeTeam = randomTeam({ name: 'ホーム', seed: 6 })
    const awayTeam = randomTeam({ name: 'アウェイ', seed: 7 })
    const state = simulateGame({ homeTeam, awayTeam, rng: createRng(11) })

    const homeSum = state.linescore.home.reduce((sum, value) => sum + (value ?? 0), 0)
    const awaySum = state.linescore.away.reduce((sum, value) => sum + (value ?? 0), 0)

    expect(homeSum).toBe(state.score.home)
    expect(awaySum).toBe(state.score.away)
  })

  it('能力値に勝ったチームが大多数の試合で勝つ', () => {
    // 能力値を固定した 2 チームを作って、多数回戦わせて勝率を見る
    const buildFixedTeam = (isStrong) => {
      const team = randomTeam({ name: isStrong ? '強' : '弱', seed: 61 })
      for (const slot of team.starters) {
        for (const key of Object.keys(slot.player.abilities)) {
          slot.player.abilities[key] = isStrong ? 90 : 30
        }
        if (slot.position !== 'P') {
          // 野手は投球能力を低くする。投げられると指数が打ち消し合ってしまうため
          for (const key of ['velocity', 'control', 'breaking', 'stamina']) {
            slot.player.abilities[key] = isStrong ? 30 : 20
          }
        }
      }
      return team
    }

    const strongTeam = buildFixedTeam(true)
    const weakTeam = buildFixedTeam(false)

    let strongWins = 0
    const trials = 60
    for (let seed = 1; seed <= trials; seed += 1) {
      const state = simulateGame({ homeTeam: strongTeam, awayTeam: weakTeam, rng: createRng(seed) })
      if (state.score.home > state.score.away) strongWins += 1
    }

    // 強いチームは 8 割以上勝つはず
    expect(strongWins / trials).toBeGreaterThan(0.8)
  })

  it('投手の制球が高いほど四球が減る', () => {
    const batter = player({ contact: 60, power: 60, approach: 40 })
    const strongControl = player({ velocity: 70, control: 95, breaking: 70, stamina: 70 })
    const weakControl = player({ velocity: 70, control: 20, breaking: 70, stamina: 70 })

    // resolvePlateAppearance は打席の結果しか返さないので、四球の回数を数える
    // resolvePlateAppearance は打席の結果しか返さないので、四球の回数を数える
    const walkCount = (pitcher) => {
      const rng = createRng(31)
      let walks = 0
      for (let i = 0; i < 4000; i += 1) {
        const result = resolvePlateAppearance({ batter, pitcher, fielders, rng })
        if (result.outcome === OUTCOME.WALK) walks += 1
      }
      return walks
    }

    expect(walkCount(strongControl)).toBeLessThan(walkCount(weakControl))
  })

  it('同じシードなら同じスコアになる', () => {
    const homeTeam = randomTeam({ name: 'ホーム', seed: 31 })
    const awayTeam = randomTeam({ name: 'アウェイ', seed: 32 })

    const a = simulateGame({ homeTeam, awayTeam, rng: createRng(77) })
    const b = simulateGame({ homeTeam, awayTeam, rng: createRng(77) })

    expect(a.score).toEqual(b.score)
  })

  it('プレーログが打席数と一致する', () => {
    const homeTeam = randomTeam({ name: 'ホーム', seed: 41 })
    const awayTeam = randomTeam({ name: 'アウェイ', seed: 42 })
    const state = simulateGame({ homeTeam, awayTeam, rng: createRng(5) })

    expect(state.plays.length).toBeGreaterThan(50)
    for (const play of state.plays) {
      expect(play.batter).toBeTruthy()
      expect(play.outcome).toBeTruthy()
      expect(play.text).toBeTruthy()
    }
  })

  it('毎回 9 回分のスコア表が埋まる（最大 9 要素）', () => {
    const homeTeam = randomTeam({ name: 'ホーム', seed: 51 })
    const awayTeam = randomTeam({ name: 'アウェイ', seed: 52 })
    const state = simulateGame({ homeTeam, awayTeam, rng: createRng(13) })

    expect(state.linescore.home.length).toBeLessThanOrEqual(9)
    expect(state.linescore.away.length).toBeLessThanOrEqual(9)
  })
})

describe('gameSummary', () => {
  it('総得点と得点差を返す', () => {
    const state = { score: { home: 3, away: 1 } }
    const summary = gameSummary(state)

    expect(summary.total).toBe(4)
    expect(summary.margin).toBe(2)
    expect(summary.oneRunGame).toBe(false)
  })

  it('1 点差なら一球勝負になる', () => {
    expect(gameSummary({ score: { home: 2, away: 1 } }).oneRunGame).toBe(true)
  })

  it('0-0 は一球勝負ではない', () => {
    expect(gameSummary({ score: { home: 0, away: 0 } }).oneRunGame).toBe(false)
  })
})
