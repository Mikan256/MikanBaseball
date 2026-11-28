import { describe, expect, it } from 'vitest'
import * as THREE from '../../vendor/three/three.module.js'
import {
  PLAYER_HEIGHT,
  PLAYER_POSES,
  createPlayerRig,
  placeRig,
} from '../../src/ui/match3d/players.js'

/** グループ内の全メッシュを集める。 */
function meshesOf(group) {
  const meshes = []
  group.traverse((object) => {
    if (object.isMesh) meshes.push(object)
  })
  return meshes
}

/** グループ内の全マテリアル色を集める。 */
function colorsOf(group) {
  return meshesOf(group).map((mesh) => mesh.material.color.getHexString())
}

describe('ローポリ選手リグ', () => {
  it('子メッシュを持ち、全高が PLAYER_HEIGHT に近い', () => {
    const rig = createPlayerRig()

    expect(rig.group.children.length).toBeGreaterThan(0)
    expect(meshesOf(rig.group).length).toBeGreaterThan(10)
    expect(meshesOf(rig.group).length).toBeLessThanOrEqual(25)

    const box = new THREE.Box3().setFromObject(rig.group)
    const height = box.max.y - box.min.y
    expect(Math.abs(height - PLAYER_HEIGHT)).toBeLessThan(0.1)
    // 足元が地面 (y=0) に接地している
    expect(box.min.y).toBeGreaterThanOrEqual(-0.02)
    expect(box.min.y).toBeLessThan(0.05)

    rig.dispose()
  })

  it('全ポーズと未知のポーズで例外が出ない', () => {
    const rig = createPlayerRig()

    for (const pose of [...PLAYER_POSES, 'unknown-pose']) {
      expect(() => rig.setPose(pose)).not.toThrow()
      expect(() => rig.update(0.5, 0.016)).not.toThrow()
      expect(() => rig.update(1.5, 0.016)).not.toThrow()
    }

    rig.dispose()
  })

  it('update を連続で呼んでも例外が出ない', () => {
    const rig = createPlayerRig({ pose: 'pitch' })

    for (let i = 0; i < 120; i += 1) {
      rig.update(i * 0.016, 0.016)
    }
    rig.setPose('swing')
    rig.update(2, 0.016)
    rig.update(2.5, 0.016)

    rig.dispose()
  })

  it('setJersey でユニフォームの色が変わる', () => {
    const rig = createPlayerRig({ jersey: '#4a90d9' })
    const before = colorsOf(rig.group)

    rig.setJersey('#123456')
    const after = colorsOf(rig.group)

    expect(after).not.toEqual(before)
    expect(after).toContain('123456')

    rig.dispose()
  })

  it('placeRig がゲーム座標を three.js 座標へ変換する', () => {
    const rig = createPlayerRig()
    placeRig(rig, 2, 4, 0)

    expect(rig.group.position.x).toBe(2)
    expect(rig.group.position.y).toBe(0)
    expect(rig.group.position.z).toBe(-4)

    rig.dispose()
  })

  it('dispose で例外が出ない', () => {
    const rig = createPlayerRig()
    rig.update(1, 0.016)

    expect(() => rig.dispose()).not.toThrow()
  })
})
