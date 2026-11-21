import { ABILITY_KEYS, MAX_BENCH, createPlayer, createTeam, validateLineup } from './roster.js'
import { POSITION_IDS } from './positions.js'
import { normalizeAbility } from './abilities.js'

/**
 * チーム編成を 1 本の文字列（JSON）にして保存・復元する。
 *
 * - 出力は人が読めるよう 2 スペースで整形した JSON。
 * - 入力は JSON そのもの。手で書き換えた場合も能力値を 1〜100 に丸める。
 * - 壊れたデータは日本語のエラー配列で返し、例外は投げない。
 */

export const TEAM_CODE_FORMAT = 'mikanbaseball-team'
export const MATCH_CODE_FORMAT = 'mikanbaseball-match'
export const TEAM_CODE_VERSION = 1

const DEFAULT_COLOR = '#f5a524'
const MAX_CODE_LENGTH = 500_000

function fail(errors) {
  return { ok: false, errors: [...new Set(errors)] }
}

function clampInt(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

function serializePlayer(player) {
  const abilities = {}
  for (const key of ABILITY_KEYS) abilities[key] = player.abilities?.[key] ?? 40

  const positionFit = {}
  for (const positionId of POSITION_IDS) {
    positionFit[positionId] = player.positionFit?.[positionId] ?? 50
  }

  return {
    id: player.id,
    name: player.name,
    number: player.number,
    bats: player.bats,
    throws: player.throws,
    age: player.age,
    height: player.height,
    weight: player.weight,
    isPitcher: Boolean(player.isPitcher),
    homePosition: player.homePosition ?? null,
    abilities,
    positionFit,
  }
}

function teamPayload(team) {
  const starters = [...team.starters]
    .sort((a, b) => a.battingOrder - b.battingOrder)
    .map((slot) => ({
      position: slot.position,
      battingOrder: slot.battingOrder,
      player: serializePlayer(slot.player),
    }))

  return {
    format: TEAM_CODE_FORMAT,
    version: TEAM_CODE_VERSION,
    name: team.name,
    color: team.color ?? DEFAULT_COLOR,
    starters,
    bench: team.bench.map(serializePlayer),
  }
}

/** 1 チームを文字列（整形済み JSON）にする */
export function serializeTeam(team) {
  return JSON.stringify(teamPayload(team), null, 2)
}

/** ホームとアウェイの 2 チームをまとめて文字列にする */
export function serializeMatch(homeTeam, awayTeam) {
  return JSON.stringify(
    {
      format: MATCH_CODE_FORMAT,
      version: TEAM_CODE_VERSION,
      home: teamPayload(homeTeam),
      away: teamPayload(awayTeam),
    },
    null,
    2,
  )
}

function sanitizePlayer(rawPlayer, { index, fallbackId, position, usedIds, errors }) {
  const raw = rawPlayer && typeof rawPlayer === 'object' ? rawPlayer : {}
  if (rawPlayer !== undefined && (rawPlayer === null || typeof rawPlayer !== 'object')) {
    errors.push(`${index + 1} 人目の選手データが不正です`)
  }

  const name = String(raw.name ?? '')
    .trim()
    .slice(0, 20)
  if (!name) errors.push(`${index + 1} 人目の選手名が空です`)

  const baseId =
    typeof raw.id === 'string' && raw.id.trim()
      ? raw.id.trim().slice(0, 80)
      : `import-${fallbackId}-${index}`
  let id = baseId
  let suffix = 2
  while (usedIds.has(id)) {
    id = `${baseId}-${suffix}`
    suffix += 1
  }
  usedIds.add(id)

  const bats = ['right', 'left', 'switch'].includes(raw.bats) ? raw.bats : 'right'
  const throws = ['right', 'left'].includes(raw.throws) ? raw.throws : 'right'
  const homePosition = POSITION_IDS.includes(raw.homePosition) ? raw.homePosition : position || null

  const abilities = {}
  const rawAbilities = raw.abilities && typeof raw.abilities === 'object' ? raw.abilities : {}
  for (const key of ABILITY_KEYS) {
    abilities[key] = normalizeAbility(rawAbilities[key] ?? 40)
  }

  const positionFit = {}
  const rawFit = raw.positionFit && typeof raw.positionFit === 'object' ? raw.positionFit : {}
  for (const positionId of POSITION_IDS) {
    positionFit[positionId] = normalizeAbility(rawFit[positionId] ?? 50)
  }

  return createPlayer({
    id,
    name: name || `選手${index + 1}`,
    number: clampInt(raw.number, 0, 99, index + 1),
    bats,
    throws,
    age: clampInt(raw.age, 15, 60, 17),
    height: clampInt(raw.height, 140, 220, 175),
    weight: clampInt(raw.weight, 35, 150, 68),
    isPitcher: typeof raw.isPitcher === 'boolean' ? raw.isPitcher : position === 'P',
    abilities,
    positionFit,
    homePosition,
  })
}

function parseJson(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return fail(['読み込む文字列が空です'])
  }
  if (text.length > MAX_CODE_LENGTH) {
    return fail(['文字列が長すぎます。チームデータの JSON を貼り付けてください'])
  }

  let payload
  try {
    payload = JSON.parse(text)
  } catch (error) {
    return fail([`JSON として読み込めません: ${error.message}`])
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return fail(['チームデータの形式が正しくありません'])
  }

  return { ok: true, payload }
}

/** 1 チーム分の payload を検証してチームにする */
function buildTeam(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return fail(['チームデータの形式が正しくありません'])
  }

  const errors = []

  if (payload.format !== undefined && payload.format !== TEAM_CODE_FORMAT) {
    errors.push('このゲームのチームデータではありません')
  }

  if (payload.version !== undefined && Number(payload.version) !== TEAM_CODE_VERSION) {
    errors.push(`対応していないデータバージョンです: ${payload.version}`)
  }

  const name = String(payload.name ?? payload.teamName ?? '')
    .trim()
    .slice(0, 20)
  if (!name) errors.push('チーム名がありません')

  if (!Array.isArray(payload.starters) || payload.starters.length !== 9) {
    return fail([...errors, '出場選手は 9 人分必要です'])
  }

  const benchRaw = payload.bench ?? []
  if (!Array.isArray(benchRaw)) {
    return fail([...errors, '控え選手のデータが配列ではありません'])
  }
  if (benchRaw.length > MAX_BENCH) {
    errors.push(`控え選手は最大 ${MAX_BENCH} 人までです`)
  }

  const usedIds = new Set()

  const starters = payload.starters.map((slot, index) => {
    const rawSlot = slot && typeof slot === 'object' ? slot : {}
    const fallbackPosition = POSITION_IDS[index]
    const position = POSITION_IDS.includes(rawSlot.position) ? rawSlot.position : fallbackPosition

    if (!POSITION_IDS.includes(rawSlot.position)) {
      errors.push(`${index + 1} 人目の守備位置が不正です`)
    }

    const battingOrder = Number(rawSlot.battingOrder)
    if (!Number.isInteger(battingOrder) || battingOrder < 1 || battingOrder > 9) {
      errors.push(`${index + 1} 人目の打席順が不正です`)
    }

    return {
      position,
      battingOrder: Number.isInteger(battingOrder) ? battingOrder : index + 1,
      player: sanitizePlayer(rawSlot.player, {
        index,
        fallbackId: position,
        position,
        usedIds,
        errors,
      }),
    }
  })

  const bench = benchRaw.map((player, index) =>
    sanitizePlayer(player, {
      index: index + 9,
      fallbackId: 'bench',
      position: null,
      usedIds,
      errors,
    }),
  )

  const color =
    typeof payload.color === 'string' && /^#[0-9a-f]{6}$/i.test(payload.color)
      ? payload.color
      : DEFAULT_COLOR

  const team = createTeam({
    name: name || '名称未設定',
    color,
    starters,
    bench,
  })

  for (const error of validateLineup(team).errors) errors.push(error)

  if (errors.length > 0) return fail(errors)

  return { ok: true, team }
}

/**
 * 文字列から 1 チームを復元する。
 *
 * @returns {{ok: true, team: object} | {ok: false, errors: string[]}}
 */
export function parseTeamCode(text) {
  const parsed = parseJson(text)
  if (!parsed.ok) return parsed

  return buildTeam(parsed.payload)
}

/**
 * 文字列から対戦データを復元する。
 * 旧形式の 1 チームデータも受け付け、その場合は `team` を返す。
 *
 * @returns {{ok: true, match: {home: object, away: object}} | {ok: true, team: object} | {ok: false, errors: string[]}}
 */
export function parseMatchCode(text) {
  const parsed = parseJson(text)
  if (!parsed.ok) return parsed

  if (parsed.payload.format === MATCH_CODE_FORMAT) {
    const home = buildTeam(parsed.payload.home)
    const away = buildTeam(parsed.payload.away)
    const errors = [
      ...(home.ok ? [] : home.errors.map((error) => `ホーム: ${error}`)),
      ...(away.ok ? [] : away.errors.map((error) => `アウェイ: ${error}`)),
    ]

    if (errors.length > 0) return fail(errors)
    return { ok: true, match: { home: home.team, away: away.team } }
  }

  return buildTeam(parsed.payload)
}
