import { describe, expect, it } from 'vitest'
import { randomTeam } from '../../src/data/rosterFactory.js'
import { renameTeam, validateLineup } from '../../src/game/roster.js'
import {
  MATCH_CODE_FORMAT,
  TEAM_CODE_FORMAT,
  TEAM_CODE_VERSION,
  parseMatchCode,
  parseTeamCode,
  serializeMatch,
  serializeTeam,
} from '../../src/game/teamCode.js'
import { POSITION_IDS } from '../../src/game/positions.js'

function makeTeam(seed = 42) {
  return randomTeam({ name: 'みかんタイガース', seed, benchCount: 5 })
}

function payloadOf(team) {
  return JSON.parse(serializeTeam(team))
}

describe('serializeTeam', () => {
  it('チーム名・9 人・控え・能力値を含む JSON 文字列を返す', () => {
    const team = makeTeam()
    const text = serializeTeam(team)
    const payload = JSON.parse(text)

    expect(typeof text).toBe('string')
    expect(payload.format).toBe(TEAM_CODE_FORMAT)
    expect(payload.version).toBe(TEAM_CODE_VERSION)
    expect(payload.name).toBe('みかんタイガース')
    expect(payload.starters).toHaveLength(9)
    expect(payload.bench).toHaveLength(5)
    expect(payload.starters[0].player.abilities.contact).toBeGreaterThan(0)
    expect(payload.starters.map((slot) => slot.position).sort()).toEqual([...POSITION_IDS].sort())
  })

  it('打席順に並べて出力する', () => {
    const team = makeTeam()
    const reversed = {
      ...team,
      starters: [...team.starters].reverse(),
    }
    const payload = payloadOf(reversed)
    expect(payload.starters.map((slot) => slot.battingOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('人が読める整形済み JSON になる', () => {
    const text = serializeTeam(makeTeam())
    expect(text).toContain('\n  "format"')
    expect(text).toContain('\n  "starters"')
  })
})

describe('parseTeamCode', () => {
  it('出力した文字列をそのまま読み込める', () => {
    const team = makeTeam(7)
    const result = parseTeamCode(serializeTeam(team))

    expect(result.ok).toBe(true)
    expect(result.team.name).toBe(team.name)
    expect(result.team.starters).toHaveLength(9)
    expect(result.team.bench).toHaveLength(5)
    expect(validateLineup(result.team).valid).toBe(true)

    const before = team.starters.map((slot) => slot.player.abilities.contact).sort()
    const after = result.team.starters.map((slot) => slot.player.abilities.contact).sort()
    expect(after).toEqual(before)
  })

  it('編集した能力値とチーム名を保持する', () => {
    const team = makeTeam()
    team.name = 'テストドラゴンズ'
    team.starters[0].player.abilities.contact = 99
    team.starters[0].player.name = '山田 エース'

    const result = parseTeamCode(serializeTeam(team))
    expect(result.ok).toBe(true)
    expect(result.team.name).toBe('テストドラゴンズ')
    expect(result.team.starters[0].player.abilities.contact).toBe(99)
    expect(result.team.starters[0].player.name).toBe('山田 エース')
  })

  it('空白付きの文字列も読み込める', () => {
    const text = `\n\n${serializeTeam(makeTeam())}\n\n`
    expect(parseTeamCode(text).ok).toBe(true)
  })

  it('空文字はエラーになる', () => {
    const result = parseTeamCode('   ')
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('空')
  })

  it('JSON でない文字列はエラーになる', () => {
    const result = parseTeamCode('これはチームデータではありません')
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('JSON')
  })

  it('別ゲームのデータや未知のバージョンは拒否する', () => {
    const payload = payloadOf(makeTeam())
    payload.format = 'other-game'
    expect(parseTeamCode(JSON.stringify(payload)).ok).toBe(false)

    const payload2 = payloadOf(makeTeam())
    payload2.version = 99
    expect(parseTeamCode(JSON.stringify(payload2)).ok).toBe(false)
  })

  it('出場選手が 9 人でないと拒否する', () => {
    const payload = payloadOf(makeTeam())
    payload.starters = payload.starters.slice(0, 8)
    const result = parseTeamCode(JSON.stringify(payload))

    expect(result.ok).toBe(false)
    expect(result.errors.join()).toContain('9 人')
  })

  it('守備位置の重複を拒否する', () => {
    const payload = payloadOf(makeTeam())
    payload.starters[1].position = payload.starters[0].position
    const result = parseTeamCode(JSON.stringify(payload))

    expect(result.ok).toBe(false)
    expect(result.errors.join()).toContain('守備位置')
  })

  it('打席順の重複を拒否する', () => {
    const payload = payloadOf(makeTeam())
    payload.starters[1].battingOrder = payload.starters[0].battingOrder
    const result = parseTeamCode(JSON.stringify(payload))

    expect(result.ok).toBe(false)
    expect(result.errors.join()).toContain('打席順')
  })

  it('控えが 8 人を超えると拒否する', () => {
    const payload = payloadOf(makeTeam())
    payload.bench = Array.from({ length: 9 }, (_, i) => ({
      name: `控え${i}`,
      isPitcher: false,
    }))
    const result = parseTeamCode(JSON.stringify(payload))

    expect(result.ok).toBe(false)
    expect(result.errors.join()).toContain('控え')
  })

  it('能力値を 1〜100 に丸める', () => {
    const payload = payloadOf(makeTeam())
    payload.starters[0].player.abilities.contact = 500
    payload.starters[0].player.abilities.power = -100
    payload.starters[0].player.positionFit.SS = 300

    const result = parseTeamCode(JSON.stringify(payload))
    expect(result.ok).toBe(true)
    expect(result.team.starters[0].player.abilities.contact).toBe(100)
    expect(result.team.starters[0].player.abilities.power).toBe(1)
    expect(result.team.starters[0].player.positionFit.SS).toBe(100)
  })

  it('id がなくても重複しない id を振る', () => {
    const payload = payloadOf(makeTeam())
    for (const slot of payload.starters) delete slot.player.id
    for (const player of payload.bench) delete player.id

    const result = parseTeamCode(JSON.stringify(payload))
    expect(result.ok).toBe(true)
    const ids = [
      ...result.team.starters.map((slot) => slot.player.id),
      ...result.team.bench.map((player) => player.id),
    ]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('チーム名が空なら拒否する', () => {
    const payload = payloadOf(makeTeam())
    payload.name = '   '
    const result = parseTeamCode(JSON.stringify(payload))

    expect(result.ok).toBe(false)
    expect(result.errors.join()).toContain('チーム名')
  })
})

describe('2 チーム分の保存・復元', () => {
  function makeMatch() {
    const home = randomTeam({ name: 'ホーム球団', seed: 71, benchCount: 3 })
    const away = randomTeam({ name: 'アウェイ球団', seed: 72, benchCount: 3 })
    away.starters[0].player.abilities.control = 88
    away.starters[0].player.name = '相手 エース'
    return { home, away }
  }

  it('ホームとアウェイをまとめて文字列にできる', () => {
    const { home, away } = makeMatch()
    const text = serializeMatch(home, away)
    const payload = JSON.parse(text)

    expect(payload.format).toBe(MATCH_CODE_FORMAT)
    expect(payload.version).toBe(TEAM_CODE_VERSION)
    expect(payload.home.name).toBe('ホーム球団')
    expect(payload.away.name).toBe('アウェイ球団')
    expect(payload.away.starters[0].player.abilities.control).toBe(88)
  })

  it('書き出した 2 チームをそのまま復元できる', () => {
    const { home, away } = makeMatch()
    const result = parseMatchCode(serializeMatch(home, away))

    expect(result.ok).toBe(true)
    expect(result.match.home.name).toBe('ホーム球団')
    expect(result.match.away.name).toBe('アウェイ球団')
    expect(result.match.away.starters[0].player.name).toBe('相手 エース')
    expect(result.match.away.starters[0].player.abilities.control).toBe(88)
    expect(validateLineup(result.match.home).valid).toBe(true)
    expect(validateLineup(result.match.away).valid).toBe(true)
  })

  it('旧形式の 1 チームデータも読み込める', () => {
    const team = makeTeam()
    const result = parseMatchCode(serializeTeam(team))

    expect(result.ok).toBe(true)
    expect(result.match).toBeUndefined()
    expect(result.team.name).toBe(team.name)
  })

  it('どちらか一方が不正ならエラーを返す', () => {
    const { home, away } = makeMatch()
    const payload = JSON.parse(serializeMatch(home, away))
    payload.away.starters = payload.away.starters.slice(0, 8)

    const result = parseMatchCode(JSON.stringify(payload))
    expect(result.ok).toBe(false)
    expect(result.errors.join()).toContain('アウェイ')
  })
})

describe('renameTeam', () => {
  it('チーム名と短縮名を更新する', () => {
    const team = makeTeam()
    const next = renameTeam(team, '  横浜ベイスターズ  ')

    expect(next.name).toBe('横浜ベイスターズ')
    expect(next.shortName).toBe('横浜ベイ')
    expect(team.name).toBe('みかんタイガース')
  })

  it('20 文字を超える名前は切り詰める', () => {
    const next = renameTeam(makeTeam(), 'あ'.repeat(30))
    expect(next.name).toHaveLength(20)
  })

  it('空の名前なら null を返す', () => {
    expect(renameTeam(makeTeam(), '   ')).toBeNull()
  })
})
