/**
 * ナイター球場の3Dジオメトリ。
 * ゲーム座標 (x, y, z) は three.js の (x, z, -y) に写す（coords.js と同じ規則）。
 * CanvasTexture や DOM API は使わず、Node 上でも組み立てと破棄ができる。
 */

import * as THREE from '../../../vendor/three/three.module.js'
import { FIELD_POINTS, FOUL_POLES } from '../../game/field.js'
import { setFromGame } from './coords.js'

const FENCE_LEFT = Math.PI * 0.78
const FENCE_RIGHT = Math.PI * 0.22
const FENCE_RADIUS = 100
const FENCE_HEIGHT = 3.4
const STAND_INNER = 104
const STAND_OUTER = 130
const STAND_TIERS = 7
const CROWD_COUNT = 800
const CROWD_SEED = 20261128

const ARC_START = FENCE_RIGHT
const ARC_LENGTH = FENCE_LEFT - FENCE_RIGHT

// ホームベース裏まで回り込む外野スタンド（左翼ポール → バックネット裏 → 右翼ポール）
const BACKSTAND_START = FENCE_LEFT
const BACKSTAND_LENGTH = Math.PI * 1.44
const BACKSTAND_CROWD_COUNT = 700
const BACKSTAND_CROWD_SEED = 20261129

// バックネット（防球ネット）とその構造物
const BACKSTOP_RADIUS = 12
const BACKSTOP_SPAN = 2.3
const BACKSTOP_WALL_HEIGHT = 2.4
const BACKSTOP_NET_HEIGHT = 6.6
const BACKSTOP_TOTAL_HEIGHT = BACKSTOP_WALL_HEIGHT + BACKSTOP_NET_HEIGHT

// バックネット裏の内野スタンド（ネットの背後に距離を取り、緩やかに立ち上がる）
const BACKSTOP_STAND_INNER = 20
const BACKSTOP_STAND_OUTER = 45
const BACKSTOP_STAND_TIERS = 5
const BACKSTOP_STAND_START = Math.PI * 1.5 - 0.78
const BACKSTOP_STAND_LENGTH = 1.56
const BACKSTOP_STAND_CROWD_COUNT = 2600
const BACKSTOP_STAND_CROWD_SEED = 20261130
// バックネット裏の観客は外野より小さくして「人の粒」に見せる
const BACKSTOP_CROWD_WIDTH = 0.3
const BACKSTOP_CROWD_HEIGHT = 0.36

const GRASS_COLORS = ['#1f5c38', '#1b5232']
const DIRT_COLOR = '#9a7a52'
const TRACK_COLOR = '#8a7358'
const FENCE_COLOR = '#17313c'
const RAIL_COLOR = '#e6d36a'
const STAND_COLOR = '#122a35'
const SKY_TOP_COLOR = '#020812'
const SKY_HORIZON_COLOR = '#17394a'
const CROWD_COLORS = ['#1b2c4a', '#7a2430', '#d8dde6', '#c9a227']

/** 決定的な線形合同法乱数（Math.random は使わない） */
function createLcg(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

/** ゲーム座標から THREE.Vector3 を作る */
function gameVector(x, y, z = 0) {
  return setFromGame(new THREE.Vector3(), x, y, z)
}

/** 扇形のリング（ホームから見た角度範囲） */
function arcSectorGeometry(inner, outer, start, length, segments = 64) {
  const geometry =
    inner > 0.0001
      ? new THREE.RingGeometry(inner, outer, segments, 1, start, length)
      : new THREE.CircleGeometry(outer, segments, start, length)
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

/** 外野スタンド用の扇形（既存の角度範囲） */
function sectorGeometry(inner, outer, segments = 96) {
  return arcSectorGeometry(inner, outer, ARC_START, ARC_LENGTH, segments)
}

/** 空のドーム。頂点カラーで上が濃紺、地平線が青緑になる */
function createSkyDome() {
  const geometry = new THREE.SphereGeometry(420, 32, 16)
  const position = geometry.getAttribute('position')
  const colors = new Float32Array(position.count * 3)
  const top = new THREE.Color(SKY_TOP_COLOR)
  const horizon = new THREE.Color(SKY_HORIZON_COLOR)
  const color = new THREE.Color()
  for (let index = 0; index < position.count; index += 1) {
    const ratio = Math.min(1, Math.max(0, position.getY(index) / 420))
    color.copy(horizon).lerp(top, ratio)
    colors[index * 3] = color.r
    colors[index * 3 + 1] = color.g
    colors[index * 3 + 2] = color.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    depthWrite: false,
  })
  return new THREE.Mesh(geometry, material)
}

/**
 * ナイター球場を組み立てる。
 * @param {{ homeColor?: string, awayColor?: string }} options
 */
export function createStadium({ homeColor = '#4a90d9', awayColor = '#f5a524' } = {}) {
  const group = new THREE.Group()
  group.name = 'stadium'
  const teamColors = { home: homeColor, away: awayColor }

  // --- 空 ---
  group.add(createSkyDome())

  // --- 地面（球場の外側まで続く暗い芝・土） ---
  const groundGeometry = new THREE.CircleGeometry(150, 64)
  groundGeometry.rotateX(-Math.PI / 2)
  const groundMaterial = new THREE.MeshLambertMaterial({ color: '#1c3a29' })
  const ground = new THREE.Mesh(groundGeometry, groundMaterial)
  ground.name = 'ground'
  ground.position.y = -0.02
  group.add(ground)

  // --- 芝と刈り込み ---
  const grassMaterial = new THREE.MeshLambertMaterial({ color: GRASS_COLORS[0] })
  const mowMaterial = new THREE.MeshLambertMaterial({ color: GRASS_COLORS[1] })
  const grass = new THREE.Mesh(sectorGeometry(0, FENCE_RADIUS), grassMaterial)
  grass.position.y = 0
  group.add(grass)
  for (let index = 0; index < 9; index += 1) {
    if (index % 2 !== 0) continue
    const inner = 10 * (index + 1)
    const band = new THREE.Mesh(sectorGeometry(inner, inner + 10), mowMaterial)
    band.position.y = 0.003 + index * 0.0004
    group.add(band)
  }

  // --- 警告トラック ---
  const trackMaterial = new THREE.MeshLambertMaterial({ color: TRACK_COLOR })
  const track = new THREE.Mesh(sectorGeometry(94, FENCE_RADIUS), trackMaterial)
  track.position.y = 0.012
  group.add(track)

  // --- 内野の土 ---
  const dirtMaterial = new THREE.MeshLambertMaterial({ color: DIRT_COLOR })
  const diamondShape = new THREE.Shape()
  const corners = [FIELD_POINTS.home, FIELD_POINTS.first, FIELD_POINTS.second, FIELD_POINTS.third]
  diamondShape.moveTo(corners[0].x, corners[0].y)
  for (let index = 1; index < corners.length; index += 1) {
    diamondShape.lineTo(corners[index].x, corners[index].y)
  }
  diamondShape.closePath()
  const diamondGeometry = new THREE.ShapeGeometry(diamondShape)
  diamondGeometry.rotateX(-Math.PI / 2)
  const diamond = new THREE.Mesh(diamondGeometry, dirtMaterial)
  diamond.position.y = 0.02
  group.add(diamond)

  const homeCircleGeometry = new THREE.CircleGeometry(3.6, 32)
  homeCircleGeometry.rotateX(-Math.PI / 2)
  const homeCircle = new THREE.Mesh(homeCircleGeometry, dirtMaterial)
  homeCircle.position.y = 0.028
  group.add(homeCircle)

  // ベースライン（土の帯）
  const pathGeometry = new THREE.BoxGeometry(1, 0.02, 0.34)
  const pathMaterial = new THREE.MeshLambertMaterial({ color: '#b08a5e' })
  const pathPairs = [
    [FIELD_POINTS.home, FIELD_POINTS.first],
    [FIELD_POINTS.first, FIELD_POINTS.second],
    [FIELD_POINTS.second, FIELD_POINTS.third],
    [FIELD_POINTS.third, FIELD_POINTS.home],
  ]
  for (const [start, end] of pathPairs) {
    const dx = end.x - start.x
    const dy = end.y - start.y
    const length = Math.hypot(dx, dy)
    const path = new THREE.Mesh(pathGeometry, pathMaterial)
    path.position.copy(gameVector((start.x + end.x) / 2, (start.y + end.y) / 2, 0.026))
    path.rotation.y = Math.atan2(dy, dx)
    path.scale.x = length
    group.add(path)
  }

  // マウンドとピッチングラバー
  const moundMaterial = new THREE.MeshLambertMaterial({ color: '#9c7b53' })
  const mound = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.7, 0.22, 32), moundMaterial)
  mound.position.copy(gameVector(0, FIELD_POINTS.pitcher.y, 0.11))
  group.add(mound)

  const rubberMaterial = new THREE.MeshLambertMaterial({ color: '#f2f2ee' })
  const rubber = new THREE.Mesh(new THREE.BoxGeometry(0.61, 0.02, 0.15), rubberMaterial)
  rubber.position.copy(gameVector(0, FIELD_POINTS.pitcher.y, 0.225))
  group.add(rubber)

  // --- 塁とホームプレート ---
  const baseGeometry = new THREE.BoxGeometry(0.45, 0.03, 0.45)
  const baseMaterial = new THREE.MeshLambertMaterial({ color: '#f7f7f2' })
  const bases = [FIELD_POINTS.first, FIELD_POINTS.second, FIELD_POINTS.third, FIELD_POINTS.home]
  for (const base of bases) {
    const marker = new THREE.Mesh(baseGeometry, baseMaterial)
    marker.position.copy(gameVector(base.x, base.y, 0.035))
    marker.rotation.y = Math.PI / 4
    group.add(marker)
  }

  // --- ファウルライン ---
  const foulPositions = []
  for (const pole of [FOUL_POLES.left, FOUL_POLES.right]) {
    foulPositions.push(0, 0.05, 0, pole.x, 0.05, -pole.y)
  }
  const foulGeometry = new THREE.BufferGeometry()
  foulGeometry.setAttribute('position', new THREE.Float32BufferAttribute(foulPositions, 3))
  const foulMaterial = new THREE.LineBasicMaterial({ color: '#e8e8de' })
  group.add(new THREE.LineSegments(foulGeometry, foulMaterial))

  // --- 外野フェンスと黄色い天端 ---
  const fenceGeometry = new THREE.CylinderGeometry(
    FENCE_RADIUS,
    FENCE_RADIUS,
    FENCE_HEIGHT,
    96,
    1,
    true,
    ARC_START + Math.PI / 2,
    ARC_LENGTH,
  )
  const fenceMaterial = new THREE.MeshLambertMaterial({
    color: FENCE_COLOR,
    side: THREE.DoubleSide,
  })
  const fence = new THREE.Mesh(fenceGeometry, fenceMaterial)
  fence.position.y = FENCE_HEIGHT / 2
  group.add(fence)

  const railGeometry = new THREE.TorusGeometry(FENCE_RADIUS, 0.13, 8, 96, ARC_LENGTH)
  railGeometry.rotateX(-Math.PI / 2)
  const railMaterial = new THREE.MeshLambertMaterial({
    color: RAIL_COLOR,
    emissive: RAIL_COLOR,
    emissiveIntensity: 0.12,
  })
  const rail = new THREE.Mesh(railGeometry, railMaterial)
  rail.position.y = FENCE_HEIGHT
  rail.rotation.y = ARC_START
  group.add(rail)

  // --- ファウルポール ---
  const poleMaterial = new THREE.MeshLambertMaterial({
    color: RAIL_COLOR,
    emissive: RAIL_COLOR,
    emissiveIntensity: 0.2,
  })
  const foulPoleGeometry = new THREE.CylinderGeometry(0.18, 0.22, 12, 12)
  for (const pole of [FOUL_POLES.left, FOUL_POLES.right]) {
    const mesh = new THREE.Mesh(foulPoleGeometry, poleMaterial)
    mesh.position.copy(gameVector(pole.x, pole.y, 6))
    group.add(mesh)
  }

  // --- スタンド（段状の観客席） ---
  const standMaterial = new THREE.MeshLambertMaterial({ color: STAND_COLOR })
  const tiers = []
  const tierWidth = (STAND_OUTER - STAND_INNER) / STAND_TIERS
  for (let index = 0; index < STAND_TIERS; index += 1) {
    const inner = STAND_INNER + tierWidth * index
    const outer = inner + tierWidth + 0.08
    const height = 1.8 + index * 1.9
    tiers.push({ inner, outer, y: height })
    const tier = new THREE.Mesh(sectorGeometry(inner, outer, 48), standMaterial)
    tier.position.y = height
    group.add(tier)
  }

  // --- 観客（インスタンス化した色ブロック） ---
  const crowdGeometry = new THREE.PlaneGeometry(0.45, 0.55)
  const crowdMaterial = new THREE.MeshLambertMaterial({
    color: '#ffffff',
    side: THREE.DoubleSide,
  })
  const crowd = new THREE.InstancedMesh(crowdGeometry, crowdMaterial, CROWD_COUNT)
  crowd.name = 'crowd'
  const palette = CROWD_COLORS.map((color) => new THREE.Color(color))
  const dummy = new THREE.Object3D()
  const random = createLcg(CROWD_SEED)
  for (let index = 0; index < CROWD_COUNT; index += 1) {
    const tier = tiers[index % tiers.length]
    const angle = ARC_START + 0.01 + random() * (ARC_LENGTH - 0.02)
    const radius = tier.inner + 0.4 + random() * Math.max(0.2, tier.outer - tier.inner - 0.8)
    dummy.position.set(Math.cos(angle) * radius, tier.y + 0.5, -Math.sin(angle) * radius)
    dummy.rotation.set(0, angle - Math.PI / 2, 0)
    dummy.scale.setScalar(0.7 + random() * 0.5)
    dummy.updateMatrix()
    crowd.setMatrixAt(index, dummy.matrix)
    crowd.setColorAt(index, palette[index % palette.length])
  }
  crowd.instanceMatrix.needsUpdate = true
  if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true
  group.add(crowd)

  // --- バックネット裏まで回り込む外野スタンド ---
  const backTiers = []
  for (let index = 0; index < STAND_TIERS; index += 1) {
    const inner = STAND_INNER + tierWidth * index
    const outer = inner + tierWidth + 0.08
    const height = 1.8 + index * 1.9
    backTiers.push({ inner, outer, y: height })
    const tier = new THREE.Mesh(
      arcSectorGeometry(inner, outer, BACKSTAND_START, BACKSTAND_LENGTH, 64),
      standMaterial,
    )
    tier.position.y = height
    group.add(tier)
  }

  const backCrowd = new THREE.InstancedMesh(crowdGeometry, crowdMaterial, BACKSTAND_CROWD_COUNT)
  backCrowd.name = 'crowd-back'
  const backRandom = createLcg(BACKSTAND_CROWD_SEED)
  for (let index = 0; index < BACKSTAND_CROWD_COUNT; index += 1) {
    const tier = backTiers[index % backTiers.length]
    const angle = BACKSTAND_START + 0.01 + backRandom() * (BACKSTAND_LENGTH - 0.02)
    const radius = tier.inner + 0.4 + backRandom() * Math.max(0.2, tier.outer - tier.inner - 0.8)
    dummy.position.set(Math.cos(angle) * radius, tier.y + 0.5, -Math.sin(angle) * radius)
    dummy.rotation.set(0, angle - Math.PI / 2, 0)
    dummy.scale.setScalar(0.7 + backRandom() * 0.5)
    dummy.updateMatrix()
    backCrowd.setMatrixAt(index, dummy.matrix)
    backCrowd.setColorAt(index, palette[index % palette.length])
  }
  backCrowd.instanceMatrix.needsUpdate = true
  if (backCrowd.instanceColor) backCrowd.instanceColor.needsUpdate = true
  group.add(backCrowd)

  // --- バックネット裏の内野スタンド（ネットのすぐ後ろに迫る観客席） ---
  const backstopTiers = []
  const backstopTierWidth = (BACKSTOP_STAND_OUTER - BACKSTOP_STAND_INNER) / BACKSTOP_STAND_TIERS
  for (let index = 0; index < BACKSTOP_STAND_TIERS; index += 1) {
    const inner = BACKSTOP_STAND_INNER + backstopTierWidth * index
    const outer = inner + backstopTierWidth + 0.1
    const height = 1.2 + index * 1.35
    backstopTiers.push({ inner, outer, y: height })
    const tier = new THREE.Mesh(
      arcSectorGeometry(inner, outer, BACKSTOP_STAND_START, BACKSTOP_STAND_LENGTH, 64),
      standMaterial,
    )
    tier.position.y = height
    group.add(tier)
  }

  const backstopCrowdGeometry = new THREE.PlaneGeometry(BACKSTOP_CROWD_WIDTH, BACKSTOP_CROWD_HEIGHT)
  const backstopCrowd = new THREE.InstancedMesh(
    backstopCrowdGeometry,
    crowdMaterial,
    BACKSTOP_STAND_CROWD_COUNT,
  )
  backstopCrowd.name = 'crowd-backstop'
  const backstopRandom = createLcg(BACKSTOP_STAND_CROWD_SEED)
  for (let index = 0; index < BACKSTOP_STAND_CROWD_COUNT; index += 1) {
    const tier = backstopTiers[index % backstopTiers.length]
    const angle = BACKSTOP_STAND_START + 0.02 + backstopRandom() * (BACKSTOP_STAND_LENGTH - 0.04)
    const radius =
      tier.inner + 0.4 + backstopRandom() * Math.max(0.2, tier.outer - tier.inner - 0.8)
    dummy.position.set(
      Math.cos(angle) * radius,
      tier.y + BACKSTOP_CROWD_HEIGHT / 2 + 0.02,
      -Math.sin(angle) * radius,
    )
    dummy.rotation.set(0, angle - Math.PI / 2, 0)
    dummy.scale.setScalar(0.8 + backstopRandom() * 0.45)
    dummy.updateMatrix()
    backstopCrowd.setMatrixAt(index, dummy.matrix)
    backstopCrowd.setColorAt(index, palette[index % palette.length])
  }
  backstopCrowd.instanceMatrix.needsUpdate = true
  if (backstopCrowd.instanceColor) backstopCrowd.instanceColor.needsUpdate = true
  group.add(backstopCrowd)

  // --- バックネット（ホームベース裏の防球ネットと構造物） ---
  const backstopGeometryArgs = (height) => [
    BACKSTOP_RADIUS,
    BACKSTOP_RADIUS,
    height,
    48,
    1,
    true,
    -BACKSTOP_SPAN / 2,
    BACKSTOP_SPAN,
  ]
  const backstop = new THREE.Group()
  backstop.name = 'backstop'

  const wallMaterial = new THREE.MeshLambertMaterial({
    color: '#14252c',
    side: THREE.DoubleSide,
  })
  const backstopWall = new THREE.Mesh(
    new THREE.CylinderGeometry(...backstopGeometryArgs(BACKSTOP_WALL_HEIGHT)),
    wallMaterial,
  )
  backstopWall.position.y = BACKSTOP_WALL_HEIGHT / 2
  backstop.add(backstopWall)

  // ネットはほぼ透明にしないと、投手視点で黒い壁のように見えてしまう
  const netMaterial = new THREE.MeshBasicMaterial({
    color: '#bcd8d2',
    transparent: true,
    opacity: 0.055,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const backstopNet = new THREE.Mesh(
    new THREE.CylinderGeometry(...backstopGeometryArgs(BACKSTOP_NET_HEIGHT)),
    netMaterial,
  )
  backstopNet.position.y = BACKSTOP_WALL_HEIGHT + BACKSTOP_NET_HEIGHT / 2
  backstop.add(backstopNet)

  const backstopEdgeMaterial = new THREE.MeshLambertMaterial({
    color: '#c2d4cb',
    emissive: '#8fbcac',
    emissiveIntensity: 0.28,
    side: THREE.DoubleSide,
  })
  const topEdgeRadius = BACKSTOP_RADIUS + 0.06
  const topEdge = new THREE.Mesh(
    new THREE.CylinderGeometry(
      topEdgeRadius,
      topEdgeRadius,
      0.28,
      48,
      1,
      true,
      -BACKSTOP_SPAN / 2,
      BACKSTOP_SPAN,
    ),
    backstopEdgeMaterial,
  )
  topEdge.position.y = BACKSTOP_TOTAL_HEIGHT - 0.14
  backstop.add(topEdge)

  const midEdge = new THREE.Mesh(
    new THREE.CylinderGeometry(
      BACKSTOP_RADIUS + 0.04,
      BACKSTOP_RADIUS + 0.04,
      0.09,
      48,
      1,
      true,
      -BACKSTOP_SPAN / 2,
      BACKSTOP_SPAN,
    ),
    backstopEdgeMaterial,
  )
  midEdge.position.y = BACKSTOP_WALL_HEIGHT + 0.6
  backstop.add(midEdge)

  const backstopPoleMaterial = new THREE.MeshLambertMaterial({ color: '#0c1b21' })
  const backstopPoleGeometry = new THREE.CylinderGeometry(
    0.14,
    0.17,
    BACKSTOP_TOTAL_HEIGHT + 0.4,
    8,
  )
  for (let index = 0; index <= 6; index += 1) {
    const theta = -BACKSTOP_SPAN / 2 + (BACKSTOP_SPAN / 6) * index
    const pole = new THREE.Mesh(backstopPoleGeometry, backstopPoleMaterial)
    pole.position.set(
      Math.sin(theta) * (BACKSTOP_RADIUS + 0.18),
      (BACKSTOP_TOTAL_HEIGHT + 0.4) / 2,
      Math.cos(theta) * (BACKSTOP_RADIUS + 0.18),
    )
    backstop.add(pole)
  }
  group.add(backstop)

  // --- バックネット裏の上部構造（屋根・照明・スコアボード） ---
  const structure = new THREE.Group()
  structure.name = 'backstop-structure'

  const soffitMaterial = new THREE.MeshLambertMaterial({ color: '#0a1922' })
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(34, 0.7, 10), soffitMaterial)
  canopy.position.set(0, 11.2, 104)
  structure.add(canopy)

  const columnGeometry = new THREE.BoxGeometry(0.55, 10, 0.55)
  for (const x of [-12.5, 12.5]) {
    const column = new THREE.Mesh(columnGeometry, soffitMaterial)
    column.position.set(x, 5.5, 105)
    structure.add(column)
  }

  const facade = new THREE.Mesh(new THREE.BoxGeometry(70, 13.5, 1.6), soffitMaterial)
  facade.position.set(0, 5, 112)
  structure.add(facade)

  const backLightMaterial = new THREE.MeshLambertMaterial({
    color: '#eaf6ff',
    emissive: '#dff1ff',
    emissiveIntensity: 1.5,
  })
  const backLightGeometry = new THREE.BoxGeometry(4.6, 0.24, 0.5)
  for (const x of [-7.5, 0, 7.5]) {
    const light = new THREE.Mesh(backLightGeometry, backLightMaterial)
    light.position.set(x, 10.2, 100)
    structure.add(light)
  }

  const signageMaterial = new THREE.MeshLambertMaterial({
    color: '#f5a524',
    emissive: '#f5a524',
    emissiveIntensity: 0.5,
  })
  const signage = new THREE.Mesh(new THREE.BoxGeometry(32, 0.8, 0.4), signageMaterial)
  signage.position.set(0, 10.6, 103)
  structure.add(signage)

  const pylonMaterial = new THREE.MeshLambertMaterial({ color: '#101f27' })
  for (const x of [-14.5, 14.5]) {
    const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, 11, 8), pylonMaterial)
    pylon.position.set(x, 5.5, 14)
    structure.add(pylon)
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.2, 0.5), backLightMaterial)
    lamp.position.set(x, 10.7, 14)
    structure.add(lamp)
  }
  group.add(structure)

  // --- 照明塔 ---
  const towerGeometry = new THREE.CylinderGeometry(0.35, 0.62, 30, 10)
  const towerMaterial = new THREE.MeshLambertMaterial({ color: '#243440' })
  const lampGeometry = new THREE.BoxGeometry(7, 3.4, 0.8)
  const lampMaterial = new THREE.MeshLambertMaterial({
    color: '#eef7ff',
    emissive: '#dff1ff',
    emissiveIntensity: 1.6,
  })
  for (const fraction of [0.28, 0.44, 0.56, 0.72]) {
    const angle = Math.PI * fraction
    const radius = 136
    const x = Math.cos(angle) * radius
    const depth = Math.sin(angle) * radius
    const tower = new THREE.Mesh(towerGeometry, towerMaterial)
    tower.position.copy(gameVector(x, depth, 15))
    group.add(tower)
    const lamp = new THREE.Mesh(lampGeometry, lampMaterial)
    lamp.position.copy(gameVector(x, depth, 30.6))
    lamp.rotation.y = Math.atan2(-x, depth)
    group.add(lamp)
  }

  // --- スコアボード ---
  const scoreboard = new THREE.Group()
  scoreboard.name = 'scoreboard'
  scoreboard.position.copy(gameVector(0, 132, 12))
  const frameMaterial = new THREE.MeshLambertMaterial({ color: '#050f16' })
  const frame = new THREE.Mesh(new THREE.BoxGeometry(28.5, 11, 1.4), frameMaterial)
  frame.position.z = -0.8
  scoreboard.add(frame)
  const panelMaterial = new THREE.MeshLambertMaterial({
    color: '#0c2029',
    emissive: '#0f2a33',
    emissiveIntensity: 0.5,
  })
  scoreboard.add(new THREE.Mesh(new THREE.BoxGeometry(26, 9, 0.9), panelMaterial))
  const homeAccentMaterial = new THREE.MeshLambertMaterial({
    color: teamColors.home,
    emissive: teamColors.home,
    emissiveIntensity: 0.4,
  })
  const awayAccentMaterial = new THREE.MeshLambertMaterial({
    color: teamColors.away,
    emissive: teamColors.away,
    emissiveIntensity: 0.4,
  })
  const accentGeometry = new THREE.BoxGeometry(9, 0.8, 0.4)
  const homeAccent = new THREE.Mesh(accentGeometry, homeAccentMaterial)
  homeAccent.position.set(-8, -3.9, 0.65)
  scoreboard.add(homeAccent)
  const awayAccent = new THREE.Mesh(accentGeometry, awayAccentMaterial)
  awayAccent.position.set(8, -3.9, 0.65)
  scoreboard.add(awayAccent)
  group.add(scoreboard)

  /** チームカラーの差し色を更新する */
  function setTeamColors({ home, away } = {}) {
    if (typeof home === 'string') teamColors.home = home
    if (typeof away === 'string') teamColors.away = away
    homeAccentMaterial.color.set(teamColors.home)
    homeAccentMaterial.emissive.set(teamColors.home)
    awayAccentMaterial.color.set(teamColors.away)
    awayAccentMaterial.emissive.set(teamColors.away)
  }

  /** 照明のわずかな揺らぎだけを更新する（毎フレームでも軽い） */
  function update(elapsedSeconds = 0) {
    lampMaterial.emissiveIntensity = 1.55 + Math.sin(elapsedSeconds * 0.7) * 0.08
  }

  /** 生成したジオメトリ・マテリアル・テクスチャをすべて破棄する */
  function dispose() {
    const geometries = new Set()
    const materials = new Set()
    group.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry)
      const list = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of list) {
        if (material) materials.add(material)
      }
    })
    for (const geometry of geometries) geometry.dispose()
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value && value.isTexture) value.dispose()
      }
      material.dispose()
    }
    group.clear()
  }

  return { group, setTeamColors, update, dispose }
}
