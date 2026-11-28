import { describe, expect, it } from 'vitest'
import {
  BALL_RADIUS,
  HIT_ARC_HEIGHT,
  HIT_FLIGHT_MS,
  HOMERUN_ARC_HEIGHT,
  PITCH_FLIGHT_MS,
  clamp01,
  courseTarget,
  easeOutCubic,
  hitArcHeight,
  hitPoint,
  hitStart,
  hitTargetFor,
  pitchPoint,
  pitchStart,
} from '../../src/game/ballFlight.js'
import { BATTED_BALL_TARGETS, FIELD_POINTS } from '../../src/game/field.js'

describe('ballFlight 定数', () => {
  it('仕様どおりの値を公開する', () => {
    expect(PITCH_FLIGHT_MS).toBe(520)
    expect(HIT_FLIGHT_MS).toBe(780)
    expect(HIT_ARC_HEIGHT).toBe(7)
    expect(HOMERUN_ARC_HEIGHT).toBe(16)
    expect(BALL_RADIUS).toBeCloseTo(0.074, 6)
  })
})

describe('clamp01', () => {
  it('範囲内はそのまま返す', () => {
    expect(clamp01(0)).toBe(0)
    expect(clamp01(0.5)).toBe(0.5)
    expect(clamp01(1)).toBe(1)
  })

  it('範囲外は 0〜1 に丸める', () => {
    expect(clamp01(-3)).toBe(0)
    expect(clamp01(4.2)).toBe(1)
  })

  it('数値でない値は 0 にする', () => {
    expect(clamp01(Number.NaN)).toBe(0)
    expect(clamp01(undefined)).toBe(0)
  })
})

describe('easeOutCubic', () => {
  it('両端と中央の値を返す', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 6)
  })

  it('入力を 0〜1 に丸める', () => {
    expect(easeOutCubic(-1)).toBe(0)
    expect(easeOutCubic(2)).toBe(1)
  })
})

describe('courseTarget', () => {
  it('左右は in / out で符号が変わる', () => {
    expect(courseTarget('middle-in').x).toBeCloseTo(-0.38, 6)
    expect(courseTarget('middle-out').x).toBeCloseTo(0.38, 6)
    expect(courseTarget('middle-center').x).toBe(0)
  })

  it('高低は high / low で変わる', () => {
    expect(courseTarget('high-center').z).toBeCloseTo(1.46, 6)
    expect(courseTarget('low-center').z).toBeCloseTo(0.58, 6)
    expect(courseTarget('middle-center').z).toBeCloseTo(1.02, 6)
  })

  it('常に捕手高さ y=0.2 を持つ', () => {
    expect(courseTarget('high-in').y).toBe(0.2)
  })

  it('null / undefined は中央へフォールバックする', () => {
    expect(courseTarget(null)).toEqual(courseTarget('middle-center'))
    expect(courseTarget(undefined)).toEqual(courseTarget('middle-center'))
  })

  it('未知のコースは中央扱いになる', () => {
    expect(courseTarget('unknown')).toEqual(courseTarget('middle-center'))
  })
})

describe('pitchStart / pitchPoint', () => {
  it('投球開始は投手の位置と高さ 1.82', () => {
    expect(pitchStart()).toEqual({ x: 0, y: FIELD_POINTS.pitcher.y, z: 1.82 })
  })

  it('t=0 は開始位置と一致する', () => {
    expect(pitchPoint('middle-center', 0)).toEqual(pitchStart())
  })

  it('t=1 はコース目標と一致する', () => {
    const end = pitchPoint('high-out', 1)
    expect(end.x).toBeCloseTo(0.38, 6)
    expect(end.y).toBeCloseTo(0.2, 6)
    expect(end.z).toBeCloseTo(1.46, 6)
  })

  it('中間点は線形補間に 0.16 の弧が乗る', () => {
    const start = pitchStart()
    const target = courseTarget('low-in')
    const middle = pitchPoint('low-in', 0.5)
    expect(middle.x).toBeCloseTo((start.x + target.x) / 2, 6)
    expect(middle.y).toBeCloseTo((start.y + target.y) / 2, 6)
    expect(middle.z).toBeCloseTo((start.z + target.z) / 2 + 0.16, 6)
  })

  it('t は 0〜1 に丸められる', () => {
    expect(pitchPoint('middle-center', -2)).toEqual(pitchPoint('middle-center', 0))
    expect(pitchPoint('middle-center', 3)).toEqual(pitchPoint('middle-center', 1))
  })
})

describe('hitTargetFor', () => {
  it('8 方向すべてで z=0.4 の落下地点を返す', () => {
    const keys = Object.keys(BATTED_BALL_TARGETS)
    expect(keys).toHaveLength(8)
    for (const key of keys) {
      const target = hitTargetFor(key)
      expect(target).not.toBeNull()
      expect(target.x).toBe(BATTED_BALL_TARGETS[key].x)
      expect(target.y).toBe(BATTED_BALL_TARGETS[key].y)
      expect(target.z).toBe(0.4)
    }
  })

  it('未知の方向は null', () => {
    expect(hitTargetFor('unknown')).toBeNull()
    expect(hitTargetFor(undefined)).toBeNull()
  })
})

describe('hitArcHeight', () => {
  it('ホームランだけ高く上がる', () => {
    expect(hitArcHeight('homerun')).toBe(16)
    expect(hitArcHeight('single')).toBe(7)
    expect(hitArcHeight(undefined)).toBe(7)
  })
})

describe('hitStart / hitPoint', () => {
  const from = hitStart()
  const to = { x: 58, y: 82, z: 0.4 }

  it('打球開始はバットの高さ', () => {
    expect(from).toEqual({ x: 0, y: 0.2, z: 1.0 })
  })

  it('t=0 は開始地点', () => {
    const point = hitPoint(from, to, HIT_ARC_HEIGHT, 0)
    expect(point.x).toBe(from.x)
    expect(point.y).toBe(from.y)
    expect(point.z).toBeCloseTo(0, 6)
  })

  it('t=1 は落下地点', () => {
    const point = hitPoint(from, to, HIT_ARC_HEIGHT, 1)
    expect(point.x).toBeCloseTo(to.x, 6)
    expect(point.y).toBeCloseTo(to.y, 6)
    expect(point.z).toBeCloseTo(0, 6)
  })

  it('頂点で弧の高さになる', () => {
    expect(hitPoint(from, to, HIT_ARC_HEIGHT, 0.5).z).toBeCloseTo(HIT_ARC_HEIGHT, 6)
    expect(hitPoint(from, to, HOMERUN_ARC_HEIGHT, 0.5).z).toBeCloseTo(HOMERUN_ARC_HEIGHT, 6)
  })

  it('水平方向は easeOutCubic で進む', () => {
    const middle = hitPoint(from, to, HIT_ARC_HEIGHT, 0.5)
    expect(middle.x).toBeCloseTo((to.x - from.x) * 0.875, 6)
    expect(middle.y).toBeCloseTo(from.y + (to.y - from.y) * 0.875, 6)
  })

  it('t は 0〜1 に丸められる', () => {
    expect(hitPoint(from, to, HIT_ARC_HEIGHT, -1)).toEqual(hitPoint(from, to, HIT_ARC_HEIGHT, 0))
    expect(hitPoint(from, to, HIT_ARC_HEIGHT, 2)).toEqual(hitPoint(from, to, HIT_ARC_HEIGHT, 1))
  })
})
