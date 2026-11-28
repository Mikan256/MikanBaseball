/**
 * 試合フェーズとカメラ設定の対応（DOM 非依存・純粋関数）。
 * CAMERA_PRESETS は旧 2D レンダラー互換のため残し、3D ビューは VIEW_PRESETS を使う。
 */

import { CAMERA_PRESETS, lerpCamera } from '../../game/camera.js'

/** フェーズから基本カメラを選ぶ（旧レンダラー互換） */
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

/**
 * 3D ビュー専用のカメラ。
 * 座標はゲーム座標 (x: 左右, y: ホームからの奥行き, z: 高さ)。
 * - pitch: 投手のやや後ろ・右肩越し。リリース手が画面下、ストライクゾーンが中央。
 * - bat: 本塁の後ろを低く・近く。打者とバットを大きく、背後にフィールド。
 */
export const VIEW_PRESETS = {
  pitch: {
    position: { x: 0.85, y: 22.2, z: 3.05 },
    target: { x: 0, y: 0.2, z: 1.28 },
    fov: 40,
  },
  bat: {
    position: { x: 1.6, y: -6.9, z: 3.3 },
    target: { x: 0.2, y: 9.5, z: 1.15 },
    fov: 52,
  },
  field: {
    position: { x: 0, y: -12, z: 12 },
    target: { x: 0, y: 46, z: 0 },
    fov: 54,
  },
}

/** 3D ビュー用のフェーズ別カメラ（入力は変更しない） */
export function viewPresetForPhase(phase) {
  if (phase === 'bat') return VIEW_PRESETS.bat
  if (phase === 'pitch') return VIEW_PRESETS.pitch
  return VIEW_PRESETS.field
}

/**
 * 打球を追うカメラ。ボールの軌道と落下地点が両方入るよう、
 * ボールの高度・奥行きに合わせて視点を少しずつ上げていく。
 */
export function dramaticHitPreset(ballPoint) {
  const x = ballPoint?.x ?? 0
  const depth = Math.max(0, ballPoint?.y ?? 0)
  const height = Math.max(0, ballPoint?.z ?? 0)
  return {
    position: {
      x: 1.6 + x * 0.16,
      y: -6.9 - Math.min(depth, 55) * 0.055,
      z: 3.3 + Math.min(height, 16) * 0.16,
    },
    target: {
      x: x * 0.6,
      y: Math.max(10.5, depth * 0.9),
      z: 1.15 + height * 0.34,
    },
    fov: 52 + Math.min(7, height * 0.32),
  }
}

/** コンタクト瞬間の画角パンチを足した設定を返す（入力は変更しない） */
export function punchPreset(preset, amount) {
  if (!preset || !Number.isFinite(amount) || amount <= 0) return preset
  return { ...preset, fov: preset.fov + amount }
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
