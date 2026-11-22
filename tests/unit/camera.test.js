import { describe, expect, it } from 'vitest'
import { CAMERA_PRESETS, createCamera, lerpCamera, projectPoint } from '../../src/game/camera.js'
import { FIELD_POINTS, FIELDER_POSITIONS, fencePoints } from '../../src/game/field.js'

const viewport = { width: 800, height: 450 }

describe('疑似3Dカメラ', () => {
  it('ホームベースが画面の下、二塁が上に投影される', () => {
    const camera = createCamera(CAMERA_PRESETS.bat)
    const home = projectPoint(camera, FIELD_POINTS.home, viewport)
    const second = projectPoint(camera, FIELD_POINTS.second, viewport)

    expect(home).not.toBeNull()
    expect(second).not.toBeNull()
    expect(home.y).toBeGreaterThan(second.y)
    expect(Math.abs(home.x - viewport.width / 2)).toBeLessThan(2)
  })

  it('一塁は画面の右、三塁は左に投影される', () => {
    const camera = createCamera(CAMERA_PRESETS.bat)
    const first = projectPoint(camera, FIELD_POINTS.first, viewport)
    const third = projectPoint(camera, FIELD_POINTS.third, viewport)

    expect(first.x).toBeGreaterThan(viewport.width / 2)
    expect(third.x).toBeLessThan(viewport.width / 2)
  })

  it('カメラの後ろの点は投影しない', () => {
    const camera = createCamera({
      position: { x: 0, y: 0, z: 2 },
      target: { x: 0, y: 10, z: 0 },
    })
    expect(projectPoint(camera, { x: 0, y: -5, z: 0 }, viewport)).toBeNull()
  })

  it('カメラ設定を補間できる', () => {
    const from = CAMERA_PRESETS.bat
    const to = CAMERA_PRESETS.field
    const middle = lerpCamera(from, to, 0.5)

    expect(middle.position.y).toBeCloseTo((from.position.y + to.position.y) / 2)
    expect(middle.target.y).toBeCloseTo((from.target.y + to.target.y) / 2)
    expect(middle.fov).toBeCloseTo((from.fov + to.fov) / 2)
  })

  it('フェンスと全守備位置が投影できる', () => {
    const camera = createCamera(CAMERA_PRESETS.field)
    const points = [
      ...fencePoints(8),
      ...Object.values(FIELDER_POSITIONS).map((position) => ({ ...position, z: 0 })),
    ]

    for (const point of points) {
      expect(projectPoint(camera, point, viewport)).not.toBeNull()
    }
  })
})
