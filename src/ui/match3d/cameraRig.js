/**
 * 試合フェーズとカメラ設定の対応（DOM 非依存・純粋関数）。
 * 旧 Canvas レンダラーと同じ CAMERA_PRESETS を使い、three.js 側は座標を変換するだけ。
 */

import { CAMERA_PRESETS, lerpCamera } from '../../game/camera.js'

/** フェーズから基本カメラを選ぶ */
export function presetForPhase(phase) {
  if (phase === 'bat') return CAMERA_PRESETS.bat
  if (phase === 'pitch') return CAMERA_PRESETS.pitch
  return CAMERA_PRESETS.field
}

/** 打球中にボールへ寄るカメラ設定（旧レンダラーの式をそのまま使う） */
export function hitFollowPreset(ballPoint) {
  const base = CAMERA_PRESETS.field
  return {
    position: {
      x: ballPoint.x * 0.12,
      y: base.position.y,
      z: base.position.z,
    },
    target: {
      x: ballPoint.x * 0.34,
      y: 28 + ballPoint.y * 0.36,
      z: 0,
    },
    fov: base.fov,
  }
}

/** カメラ設定を目標へ補間する（入力は変更しない） */
export function stepCamera(current, target, amount = 0.1) {
  return lerpCamera(current, target, amount)
}

/** 位置・注視点・画角がすべて許容誤差内なら true */
export function cameraSettled(a, b, epsilon = 0.01) {
  if (!a || !b) return false
  const near = (from, to) => Math.abs(from - to) <= epsilon
  return (
    near(a.position.x, b.position.x) &&
    near(a.position.y, b.position.y) &&
    near(a.position.z, b.position.z) &&
    near(a.target.x, b.target.x) &&
    near(a.target.y, b.target.y) &&
    near(a.target.z, b.target.z) &&
    near(a.fov, b.fov)
  )
}
