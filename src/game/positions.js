/** 守備位置の定義。DH はないので 9 人全員が守備に就く。 */

export const POSITIONS = [
  { id: 'P', label: '投手', short: '投', order: 1 },
  { id: 'C', label: '捕手', short: '捕', order: 2 },
  { id: '1B', label: '一塁手', short: '一', order: 3 },
  { id: '2B', label: '二塁手', short: '二', order: 4 },
  { id: '3B', label: '三塁手', short: '三', order: 5 },
  { id: 'SS', label: '遊撃手', short: '遊', order: 6 },
  { id: 'LF', label: '左翼手', short: '左', order: 7 },
  { id: 'CF', label: '中堅手', short: '中', order: 8 },
  { id: 'RF', label: '右翼手', short: '右', order: 9 },
]

export const POSITION_IDS = POSITIONS.map((position) => position.id)

export const POSITION_BY_ID = Object.fromEntries(
  POSITIONS.map((position) => [position.id, position]),
)

export const POSITION_LABEL = Object.fromEntries(
  POSITIONS.map((position) => [position.id, position.label]),
)

/** 出場させる 9 人の数 */
export const ON_FIELD_COUNT = POSITIONS.length

export const INFIELD_POSITIONS = ['1B', '2B', '3B', 'SS']
export const OUTFIELD_POSITIONS = ['LF', 'CF', 'RF']

/**
 * 打球ごとに守備に関与する位置を返す。
 * 左中間などへ抜けると、隣りの外野手も動くので複数の位置が並ぶ。
 */
export function involvedFielders(location) {
  switch (location) {
    case '1B':
      return ['1B', '2B']
    case '2B':
      return ['2B', 'SS', '3B']
    case '3B':
      return ['3B', 'SS']
    case 'SS':
      return ['SS', '2B']
    case 'LF':
      return ['LF', 'CF']
    case 'CF':
      return ['CF', 'LF', 'RF']
    case 'RF':
      return ['RF', 'CF']
    case 'gap':
      return ['CF', 'LF', 'RF']
    default:
      return ['SS', '2B', 'CF']
  }
}

/** 打球位置の一覧と重み。power が強いほど外野へ飛ばしやすい。 */
export const BATTED_BALL_LOCATIONS = [
  { id: '1B', weight: 0.16 },
  { id: '2B', weight: 0.13 },
  { id: '3B', weight: 0.1 },
  { id: 'SS', weight: 0.09 },
  { id: 'LF', weight: 0.12 },
  { id: 'CF', weight: 0.15 },
  { id: 'RF', weight: 0.12 },
  { id: 'gap', weight: 0.13 },
]
