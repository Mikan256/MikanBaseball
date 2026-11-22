import { describe, expect, it } from 'vitest'
import {
  OnlineMatch,
  applyOnlineAction,
  sanitizeOnlineAction,
} from '../../src/net/flaxiaMultiplayer.js'
import { packMatchState, packedStateSize, unpackMatchState } from '../../src/net/onlineState.js'
import {
  autoPlayLiveGame,
  createLiveGame,
  currentBatter,
  submitPitch,
} from '../../src/game/liveGame.js'
import { createRng } from '../../src/game/rng.js'
import { randomTeam } from '../../src/data/rosterFactory.js'
import { serializeTeam } from '../../src/game/teamCode.js'

const home = randomTeam({ name: 'ホーム', seed: 91 })
const away = randomTeam({ name: 'アウェイ', seed: 92 })

function newOnlineGame(seed = 1) {
  const rng = createRng(seed)
  return {
    rng,
    state: createLiveGame({
      homeTeam: home,
      awayTeam: away,
      mode: 'two-player',
      rng,
    }),
  }
}

describe('オンライン状態の圧縮', () => {
  it('チーム情報を除いて送信し、受信側で復元できる', () => {
    const { state } = newOnlineGame()
    const packed = packMatchState(state)

    expect(packed.teams).toBeUndefined()
    expect(packed.log.length).toBeLessThanOrEqual(40)
    expect(packed.plays.length).toBeLessThanOrEqual(120)
    expect(packedStateSize(state)).toBeLessThan(60_000)

    const restored = unpackMatchState(packed, { home, away })
    expect(restored.teams.home.name).toBe('ホーム')
    expect(restored.teams.away.name).toBe('アウェイ')
    expect(restored.score).toEqual(state.score)
    expect(restored.phase).toBe(state.phase)
    expect(currentBatter(restored).name).toBe(currentBatter(state).name)
  })

  it('2人プレイの保留球種を復元できる', () => {
    const { state, rng } = newOnlineGame()
    submitPitch(state, { typeId: 'slider', courseId: 'low-out', releaseQuality: 0.8 }, rng)

    const restored = unpackMatchState(packMatchState(state), { home, away })

    expect(restored.phase).toBe('bat')
    expect(restored.currentPitch.type.label).toBe('スライダー')
    expect(restored.currentPitch.course.label).toBe('低め外角')
    expect(restored.currentPitchQuality).toBeCloseTo(0.8)
  })

  it('長い試合でも64KB未満に収まる', () => {
    const { state, rng } = newOnlineGame(7)
    autoPlayLiveGame(state, rng)

    expect(state.finished).toBe(true)
    expect(packedStateSize(state)).toBeLessThan(60_000)
  })

  it('開始メッセージも64KB未満に収まる', () => {
    const { state } = newOnlineGame()
    const message = {
      type: 'mikan:start',
      home: JSON.parse(serializeTeam(home)),
      away: JSON.parse(serializeTeam(away)),
      seed: 1,
      state: packMatchState(state),
    }

    expect(JSON.stringify(message).length).toBeLessThan(60_000)
  })
})

describe('オンライン操作の検証', () => {
  it('不正な操作を拒否する', () => {
    expect(sanitizeOnlineAction(null)).toBeNull()
    expect(sanitizeOnlineAction({ kind: 'pitch' })).toBeNull()
    expect(sanitizeOnlineAction({ kind: 'pitch', selection: { typeId: 'straight' } })).toBeNull()
    expect(sanitizeOnlineAction({ kind: 'bat', swing: 'bunt' })).toBeNull()
  })

  it('投球と打撃の値を正規化する', () => {
    expect(
      sanitizeOnlineAction({
        kind: 'pitch',
        selection: { typeId: 'straight', courseId: 'middle-center', releaseQuality: 5 },
      }),
    ).toEqual({
      kind: 'pitch',
      selection: { typeId: 'straight', courseId: 'middle-center', releaseQuality: 1 },
    })

    expect(
      sanitizeOnlineAction({ kind: 'bat', swing: 'contact', timingQuality: -3, cursorMatch: 1 }),
    ).toEqual({
      kind: 'bat',
      swing: 'contact',
      timingQuality: 0,
      cursorMatch: true,
    })
  })

  it('ホスト側でピアの操作を試合に適用できる', () => {
    const { state, rng } = newOnlineGame(3)

    expect(
      applyOnlineAction(
        state,
        {
          kind: 'pitch',
          selection: { typeId: 'straight', courseId: 'middle-center', releaseQuality: 0.7 },
        },
        rng,
      ),
    ).toBe(true)
    expect(state.phase).toBe('bat')
    expect(state.log).toHaveLength(0)

    expect(
      applyOnlineAction(
        state,
        { kind: 'bat', swing: 'contact', timingQuality: 0.8, cursorMatch: true },
        rng,
      ),
    ).toBe(true)
    expect(state.log).toHaveLength(1)
    expect(state.phase).toBe('pitch')
  })
})

describe('OnlineMatch', () => {
  it('初期状態では未接続で、ローカル環境では利用不可と返す', () => {
    const online = new OnlineMatch()
    const snapshot = online.snapshot()

    expect(snapshot.connected).toBe(false)
    expect(snapshot.available).toBe(false)
    expect(snapshot.roomId).toBeNull()
  })
})
