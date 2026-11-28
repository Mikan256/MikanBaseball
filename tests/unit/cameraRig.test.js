import { describe, expect, it } from 'vitest'
import { CAMERA_PRESETS } from '../../src/game/camera.js'
import {
  cameraSettled,
  hitFollowPreset,
  presetForPhase,
  stepCamera,
} from '../../src/ui/match3d/cameraRig.js'

describe('presetForPhase', () => {
  it("'bat' は打席カメラ", () => {
    expect(presetForPhase('bat')).toEqual(CAMERA_PRESETS.bat)
  })

  it("'pitch' は投球カメラ", () => {
    expect(presetForPhase('pitch')).toEqual(CAMERA_PRESETS.pitch)
  })

  it("'field' はフィールドカメラ", () => {
    expect(presetForPhase('field')).toEqual(CAMERA_PRESETS.field)
  })

  it('未定義や未知の値はフィールドカメラ', () => {
    expect(presetForPhase(undefined)).toEqual(CAMERA_PRESETS.field)
    expect(presetForPhase('unknown')).toEqual(CAMERA_PRESETS.field)
  })
})

describe('hitFollowPreset', () => {
  it('旧レンダラーと同じ式でボールへ寄る', () => {
    const preset = hitFollowPreset({ x: 100, y: 50 })
    expect(preset.position.x).toBeCloseTo(12)
    expect(preset.position.y).toBe(CAMERA_PRESETS.field.position.y)
    expect(preset.position.z).toBe(CAMERA_PRESETS.field.position.z)
    expect(preset.target.x).toBeCloseTo(34)
    expect(preset.target.y).toBeCloseTo(28 + 50 * 0.36)
    expect(preset.target.z).toBe(0)
    expect(preset.fov).toBe(CAMERA_PRESETS.field.fov)
  })

  it('CAMERA_PRESETS.field を変更しない', () => {
    const before = JSON.parse(JSON.stringify(CAMERA_PRESETS.field))
    hitFollowPreset({ x: -80, y: 120 })
    expect(CAMERA_PRESETS.field).toEqual(before)
  })
})

describe('stepCamera', () => {
  it('amount の割合だけ補間する', () => {
    const next = stepCamera(CAMERA_PRESETS.field, CAMERA_PRESETS.bat, 0.25)
    expect(next.position.x).toBeCloseTo(0)
    expect(next.position.y).toBeCloseTo(-12 + (CAMERA_PRESETS.bat.position.y + 12) * 0.25)
    expect(next.position.z).toBeCloseTo(12 + (CAMERA_PRESETS.bat.position.z - 12) * 0.25)
    expect(next.target.z).toBeCloseTo(0 + (CAMERA_PRESETS.bat.target.z - 0) * 0.25)
    expect(next.fov).toBeCloseTo(54 + (CAMERA_PRESETS.bat.fov - 54) * 0.25)
  })

  it('amount は 0〜1 に丸められる', () => {
    const over = stepCamera(CAMERA_PRESETS.field, CAMERA_PRESETS.bat, 3)
    expect(over).toEqual(CAMERA_PRESETS.bat)

    const under = stepCamera(CAMERA_PRESETS.field, CAMERA_PRESETS.bat, -1)
    expect(under).toEqual(CAMERA_PRESETS.field)
  })

  it('入力のカメラ設定を変更しない', () => {
    const from = JSON.parse(JSON.stringify(CAMERA_PRESETS.field))
    const to = JSON.parse(JSON.stringify(CAMERA_PRESETS.bat))
    stepCamera(from, to, 0.5)
    expect(from).toEqual(CAMERA_PRESETS.field)
    expect(to).toEqual(CAMERA_PRESETS.bat)
  })
})

describe('cameraSettled', () => {
  it('同じ設定なら true', () => {
    expect(cameraSettled(CAMERA_PRESETS.bat, CAMERA_PRESETS.bat)).toBe(true)
  })

  it('誤差が epsilon 以内なら true', () => {
    const near = {
      position: { x: 0.005, y: 0.005, z: 0.005 },
      target: { x: 0.005, y: 0.005, z: 0.005 },
      fov: 0.005,
    }
    const origin = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, fov: 0 }
    expect(cameraSettled(near, origin)).toBe(true)
  })

  it('誤差が epsilon を超えたら false', () => {
    const origin = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, fov: 0 }
    const far = {
      position: { x: 0.5, y: 0, z: 0 },
      target: { x: 0, y: 0, z: 0 },
      fov: 0,
    }
    expect(cameraSettled(far, origin)).toBe(false)

    const farFov = {
      position: { x: 0, y: 0, z: 0 },
      target: { x: 0, y: 0, z: 0 },
      fov: 0.02,
    }
    expect(cameraSettled(farFov, origin)).toBe(false)
  })

  it('null を渡されたら false', () => {
    expect(cameraSettled(null, CAMERA_PRESETS.bat)).toBe(false)
    expect(cameraSettled(CAMERA_PRESETS.bat, null)).toBe(false)
  })
})
