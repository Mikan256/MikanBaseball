/**
 * 投球・打球の軌道計算（DOM 非依存の純粋関数）。
 * 旧 Canvas レンダラーのアニメーション数値をそのまま持ち込み、テスト可能にしたもの。
 */

import { BATTED_BALL_TARGETS, FIELD_POINTS } from './field.js'

/** 投球がホームまで届く時間（ミリ秒） */
export const PITCH_FLIGHT_MS = 520
/** 打球が落下地点に届く時間（ミリ秒） */
export const HIT_FLIGHT_MS = 780
/** 通常の打球の弧の高さ（m） */
export const HIT_ARC_HEIGHT = 7
/** ホームランの弧の高さ（m） */
export const HOMERUN_ARC_HEIGHT = 16
/** 野球ボールの半径（m） */
export const BALL_RADIUS = 0.074

/** 0〜1 に丸める */
export function clamp01(value) {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** 終わりが緩やかなイージング */
export function easeOutCubic(value) {
  return 1 - (1 - clamp01(value)) ** 3
}

/** コースID（例: 'high-in'）から捕手位置の目標座標を返す */
export function courseTarget(courseId) {
  const id = courseId ?? 'middle-center'
  const [row, column] = String(id).split('-')
  return {
    x: column === 'in' ? -0.38 : column === 'out' ? 0.38 : 0,
    y: 0.2,
    z: row === 'high' ? 1.46 : row === 'low' ? 0.58 : 1.02,
  }
}

/** 投球の開始位置（投手の手元） */
export function pitchStart() {
  return { x: 0, y: FIELD_POINTS.pitcher.y, z: 1.82 }
}

/** 投球の軌道上の点。t は 0（リリース）〜1（捕手） */
export function pitchPoint(courseId, t) {
  const progress = clamp01(t)
  const start = pitchStart()
  const target = courseTarget(courseId)
  const point = {
    x: start.x + (target.x - start.x) * progress,
    y: start.y + (target.y - start.y) * progress,
    z: start.z + (target.z - start.z) * progress,
  }
  point.z += Math.sin(Math.PI * progress) * 0.16
  return point
}

/** 打球方向から落下地点を返す。未知の方向なら null */
export function hitTargetFor(location) {
  const target = BATTED_BALL_TARGETS[location]
  if (!target) return null
  return { x: target.x, y: target.y, z: 0.4 }
}

/** 打球結果に応じた弧の高さ */
export function hitArcHeight(outcome) {
  return outcome === 'homerun' ? HOMERUN_ARC_HEIGHT : HIT_ARC_HEIGHT
}

/** 打球の軌道上の点。t は 0（打撃）〜1（落下） */
export function hitPoint(from, to, height, t) {
  const progress = clamp01(t)
  const eased = easeOutCubic(progress)
  return {
    x: from.x + (to.x - from.x) * eased,
    y: from.y + (to.y - from.y) * eased,
    z: Math.sin(Math.PI * progress) * height,
  }
}

/** 打球の開始位置（バットの当たる高さ） */
export function hitStart() {
  return { x: 0, y: 0.2, z: 1.0 }
}
