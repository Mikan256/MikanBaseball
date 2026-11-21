import { createRng } from '../game/rng.js'
import { POSITION_IDS } from '../game/positions.js'
import { normalizeAbility } from '../game/abilities.js'
import { createPlayer, createTeam } from '../game/roster.js'

const SURNAME_LIST = [
  '佐藤',
  '鈴木',
  '高橋',
  '田中',
  '伊藤',
  '渡辺',
  '山本',
  '中村',
  '小林',
  '加藤',
  '吉田',
  '山田',
  '松本',
  '井上',
  '木村',
  '林',
  '斎藤',
  '清水',
  '山口',
  '森',
  '池田',
  '橋本',
  '阿部',
  '石川',
  '山下',
  '中島',
  '石井',
  '小川',
  '前田',
  '岡田',
  '藤田',
  '後藤',
  '久保',
  '松井',
  '杉浦',
  '大野',
  '富田',
  '西村',
  '平田',
  '原田',
]

const GIVEN_NAME_LIST = [
  '大翔',
  '蓮',
  '悠斗',
  '颯太',
  '陽向',
  '陸',
  '海斗',
  '悠真',
  '健太',
  '直樹',
  '拓海',
  '光',
  '暖',
  '涼太',
  '翔',
  '雄大',
  '智也',
  '和也',
  '達也',
  '修平',
  '一輝',
  '大輝',
  '誠',
  '亮',
  '剛',
  '駿',
  '怜',
  '千尋',
  '美月',
  '陽菜',
  '瑛太',
  '優斗',
  '海翔',
  '匠',
  '祐樹',
  '奏太',
  '愛斗',
  '翔太',
  '陸斗',
  '虎太郎',
]

/** 守備位置ごとの能力の得意・不得意 */
const POSITION_TRAITS = {
  P: {
    pitching: 1.0,
    batting: 0.25,
    defense: 0.4,
    velocity: 1.1,
    control: 1.05,
    breaking: 1.05,
    stamina: 1.0,
  },
  C: { batting: 0.6, defense: 1.0, arm: 0.8 },
  '1B': { batting: 0.95, defense: 0.7, arm: 0.6 },
  '2B': { batting: 0.8, defense: 0.95, arm: 0.8, speed: 0.95 },
  '3B': { batting: 0.8, defense: 0.9, arm: 1.0, power: 0.95 },
  SS: { batting: 0.8, defense: 1.0, arm: 0.95, speed: 1.0 },
  LF: { batting: 0.9, defense: 0.85, arm: 0.9 },
  CF: { batting: 0.85, defense: 0.95, arm: 0.9, speed: 1.05 },
  RF: { batting: 0.9, defense: 0.85, arm: 1.0, power: 0.95 },
}

/** 守備位置ごとの適性を作る */
function createPositionFit(primary, rng, talent = 60) {
  const fit = {}
  for (const positionId of POSITION_IDS) {
    if (positionId === primary) {
      fit[positionId] = normalizeAbility(talent + 20 + (rng.next() * 20 - 10))
    } else if (primary === 'P' || positionId === 'P') {
      fit[positionId] = normalizeAbility(15 + rng.next() * 25)
    } else {
      const distance = Math.abs(POSITION_IDS.indexOf(positionId) - POSITION_IDS.indexOf(primary))
      const penalty = distance * 8
      fit[positionId] = normalizeAbility(30 + rng.next() * 40 - penalty)
    }
  }
  return fit
}

/** 1 人の選手をランダムに作成 */
export function randomPlayer(rng, { position = null, index = 0, seedOffset = 0 } = {}) {
  const id = `p-${seedOffset}-${index}-${Math.floor(rng.next() * 1_000_000)}`
  const surname = rng.pick(SURNAME_LIST)
  const givenName = rng.pick(GIVEN_NAME_LIST)
  const name = `${surname} ${givenName}`
  const isPitcher = position === 'P'

  const talent = 45 + rng.next() * 40 // 45〜85
  const traits = position ? (POSITION_TRAITS[position] ?? {}) : {}

  const trait = (key) => traits[key] ?? 0.5

  const abilities = {
    // 打撃
    contact: normalizeAbility(
      (talent * 0.6 + rng.next() * talent * 0.4) * (0.7 + trait('batting') * 0.6) +
        (isPitcher ? -20 : 0),
    ),
    power: normalizeAbility(
      (talent * 0.6 + rng.next() * talent * 0.4) * (0.7 + trait('batting') * 0.5) +
        (isPitcher ? -20 : 0),
    ),
    speed: normalizeAbility(
      (talent * 0.5 + rng.next() * talent * 0.4) * (0.7 + trait('speed') * 0.6),
    ),
    approach: normalizeAbility(
      (talent * 0.55 + rng.next() * talent * 0.4) * (0.8 + trait('batting') * 0.3) +
        (isPitcher ? -10 : 0),
    ),
    // 投球
    velocity: normalizeAbility(
      (talent * 0.55 + rng.next() * talent * 0.4) * (0.7 + trait('pitching') * 0.5) +
        (isPitcher ? 20 : -35),
    ),
    control: normalizeAbility(
      (talent * 0.55 + rng.next() * talent * 0.4) * (0.7 + trait('pitching') * 0.5) +
        (isPitcher ? 18 : -35),
    ),
    breaking: normalizeAbility(
      (talent * 0.5 + rng.next() * talent * 0.4) * (0.7 + trait('pitching') * 0.5) +
        (isPitcher ? 16 : -35),
    ),
    stamina: normalizeAbility(
      (talent * 0.5 + rng.next() * talent * 0.4) * (0.7 + trait('pitching') * 0.4) +
        (isPitcher ? 14 : -25),
    ),
    // 守備
    fielding: normalizeAbility(
      (talent * 0.55 + rng.next() * talent * 0.4) * (0.7 + trait('defense') * 0.6) +
        (isPitcher ? -25 : 0),
    ),
    arm: normalizeAbility(
      (talent * 0.55 + rng.next() * talent * 0.4) * (0.7 + trait('arm') * 0.6) +
        (isPitcher ? -10 : 0),
    ),
    throwing: normalizeAbility(
      (talent * 0.5 + rng.next() * talent * 0.4) * (0.7 + trait('defense') * 0.5),
    ),
  }

  const positionFit = createPositionFit(position ?? 'C', rng, talent)

  return createPlayer({
    id,
    name,
    number: 10 + (index % 20) + Math.floor(rng.next() * 40),
    bats: rng.next() < 0.7 ? 'right' : rng.next() < 0.5 ? 'left' : 'switch',
    throws: rng.next() < 0.75 ? 'right' : 'left',
    age: 16 + Math.floor(rng.next() * 3),
    height: isPitcher ? 172 + Math.floor(rng.next() * 12) : 168 + Math.floor(rng.next() * 16),
    weight: isPitcher ? 64 + Math.floor(rng.next() * 14) : 60 + Math.floor(rng.next() * 18),
    isPitcher,
    abilities,
    positionFit,
    // 生成時の主位置。starters では必ずここを守備位置に使う
    homePosition: position ?? 'C',
  })
}

/** 9 人のスターティングメンバーを作る */
export function randomStarters(rng, { seedOffset = 0 } = {}) {
  const positions = [...POSITION_IDS]
  const players = positions.map((position, index) =>
    randomPlayer(rng, { position, index, seedOffset }),
  )

  // 打席順: 1番は出塁重視、4番は長打重視、下位はバランス
  const sorted = [...players].sort((a, b) => {
    const valueA = a.abilities.contact * 0.5 + a.abilities.speed * 0.3 + a.abilities.approach * 0.2
    const valueB = b.abilities.contact * 0.5 + b.abilities.speed * 0.3 + b.abilities.approach * 0.2
    return valueB - valueA
  })

  // 守備位置は生成時の主位置をそのまま使う。
  // 打席順に並べ替えても 9 位置が 1 対 1 で対応することが保証される。
  const starters = sorted.map((player, index) => ({
    player,
    position: player.homePosition,
    battingOrder: index + 1,
  }))

  return starters
}

/** 控え選手を作る */
export function randomBench(rng, { count = 5, seedOffset = 100 } = {}) {
  return Array.from({ length: count }, (_, index) =>
    randomPlayer(rng, { position: null, index, seedOffset }),
  )
}

/** チームをランダム生成 */
export function randomTeam({ name, color = '#4a90d9', seed = 1, benchCount = 5 }) {
  const rng = createRng(seed)
  return createTeam({
    name,
    color,
    starters: randomStarters(rng, { seedOffset: seed }),
    bench: randomBench(rng, { count: benchCount, seedOffset: seed + 500 }),
  })
}
