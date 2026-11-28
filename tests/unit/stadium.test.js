import { describe, expect, it } from 'vitest'
import { createStadium } from '../../src/ui/match3d/stadium.js'

describe('createStadium', () => {
  it('グループに十分な数のメッシュを持つ', () => {
    const stadium = createStadium()
    expect(stadium.group.type).toBe('Group')
    expect(stadium.group.children.length).toBeGreaterThan(0)

    let meshes = 0
    stadium.group.traverse((object) => {
      if (object.isMesh) meshes += 1
    })
    expect(meshes).toBeGreaterThanOrEqual(20)

    stadium.dispose()
  })

  it('チームカラーの更新で例外を出さない', () => {
    const stadium = createStadium()
    expect(() => stadium.setTeamColors({ home: '#112233', away: '#445566' })).not.toThrow()
    expect(() => stadium.setTeamColors({})).not.toThrow()
    stadium.dispose()
  })

  it('update が例外を出さない', () => {
    const stadium = createStadium()
    expect(() => stadium.update(1.5)).not.toThrow()
    expect(() => stadium.update()).not.toThrow()
    stadium.dispose()
  })

  it('dispose が例外を出さず子要素を片付ける', () => {
    const stadium = createStadium()
    expect(() => stadium.dispose()).not.toThrow()
    expect(stadium.group.children).toHaveLength(0)
  })

  it('観客はシード付きで決定的に配置される', () => {
    const first = createStadium()
    const second = createStadium()
    let firstCrowd = null
    let secondCrowd = null
    first.group.traverse((object) => {
      if (object.name === 'crowd') firstCrowd = object
    })
    second.group.traverse((object) => {
      if (object.name === 'crowd') secondCrowd = object
    })
    expect(firstCrowd).not.toBeNull()
    expect(secondCrowd).not.toBeNull()
    expect(Array.from(firstCrowd.instanceMatrix.array)).toEqual(
      Array.from(secondCrowd.instanceMatrix.array),
    )
    first.dispose()
    second.dispose()
  })
})
