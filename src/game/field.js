/**
 * フィールド上のワールド座標。
 * ホームベースを原点に、センター方向を +y とする（単位はメートル）。
 */

export const FIELD_POINTS = {
  home: { x: 0, y: 0, z: 0 },
  first: { x: 19.4, y: 19.4, z: 0 },
  second: { x: 0, y: 38.8, z: 0 },
  third: { x: -19.4, y: 19.4, z: 0 },
  pitcher: { x: 0, y: 18.44, z: 0 },
  catcher: { x: 0, y: -1.8, z: 0 },
}

/** 守備位置ごとの立ち位置 */
export const FIELDER_POSITIONS = {
  P: { x: 0, y: 18.44 },
  C: { x: 0, y: -2.2 },
  '1B': { x: 20, y: 22 },
  '2B': { x: 5, y: 35 },
  '3B': { x: -20, y: 22 },
  SS: { x: -7, y: 32 },
  LF: { x: -55, y: 82 },
  CF: { x: 0, y: 97 },
  RF: { x: 55, y: 82 },
}

/** 打球方向ごとの落下地点 */
export const BATTED_BALL_TARGETS = {
  '1B': { x: 18, y: 20 },
  '2B': { x: 4, y: 37 },
  '3B': { x: -18, y: 20 },
  SS: { x: -8, y: 31 },
  LF: { x: -58, y: 82 },
  CF: { x: 0, y: 98 },
  RF: { x: 58, y: 82 },
  gap: { x: -34, y: 90 },
}

/** 外野フェンスの左右の角度（ラジアン） */
const FENCE_LEFT = Math.PI * 0.34
const FENCE_RIGHT = Math.PI * 0.16
const FENCE_RADIUS = 100

/** フェンスの弧を点列にする */
export function fencePoints(steps = 18) {
  const points = []
  for (let index = 0; index <= steps; index += 1) {
    const angle = FENCE_LEFT + ((FENCE_RIGHT - FENCE_LEFT) * index) / steps
    points.push({
      x: Math.cos(angle) * FENCE_RADIUS,
      y: Math.sin(angle) * FENCE_RADIUS,
      z: 0,
    })
  }
  return points
}

/** ホームから左右のポールまでのファウルライン */
export const FOUL_POLES = {
  left: { x: Math.cos(FENCE_LEFT) * FENCE_RADIUS, y: Math.sin(FENCE_LEFT) * FENCE_RADIUS },
  right: { x: Math.cos(FENCE_RIGHT) * FENCE_RADIUS, y: Math.sin(FENCE_RIGHT) * FENCE_RADIUS },
}

/** 塁上の走者の位置 */
export const BASE_POSITIONS = [
  { x: 19.4, y: 19.4 },
  { x: 0, y: 38.8 },
  { x: -19.4, y: 19.4 },
]
