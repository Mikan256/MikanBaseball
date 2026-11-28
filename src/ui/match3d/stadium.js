/**
 * ナイター球場の3Dジオメトリ。
 * ゲーム座標 (x, y, z) は three.js の (x, z, -y) に写す（coords.js と同じ規則）。
 * CanvasTexture や DOM API は使わず、Node 上でも組み立てと破棄ができる。
 * 文字はドットマトリクスのジオメトリで表現し、光の滲みだけを DataTexture で作る。
 */

import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { FIELD_POINTS, FOUL_POLES } from '../../game/field.js'
import { setFromGame } from './coords.js'

const FENCE_LEFT = Math.PI * 0.78
const FENCE_RIGHT = Math.PI * 0.22
const FENCE_RADIUS = 100
const FENCE_HEIGHT = 3.4
const STAND_INNER = 104
const STAND_OUTER = 130
const STAND_TIERS = 8
const CROWD_COUNT = 1500
const CROWD_SEED = 20261128

const ARC_START = FENCE_RIGHT
const ARC_LENGTH = FENCE_LEFT - FENCE_RIGHT

// ホームベース裏まで回り込む外野スタンド（左翼ポール → バックネット裏 → 右翼ポール）
const BACKSTAND_START = FENCE_LEFT
const BACKSTAND_LENGTH = Math.PI * 1.44
const BACKSTAND_CROWD_COUNT = 1200
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
const BACKSTOP_STAND_CROWD_COUNT = 3400
const BACKSTOP_STAND_CROWD_SEED = 20261130
// バックネット裏の観客は外野より小さくして「人の粒」に見せる
const BACKSTOP_CROWD_WIDTH = 0.3
const BACKSTOP_CROWD_HEIGHT = 0.36

const GRASS_COLORS = ['#247844', '#1d6539', '#2a8350']
const DIRT_COLOR = '#a98056'
const TRACK_COLOR = '#947a5c'
const FENCE_COLOR = '#17313c'
const PADDING_COLOR = '#123e36'
const RAIL_COLOR = '#e6d36a'
const STAND_COLOR = '#1a3440'
const CONCRETE_COLOR = '#273f49'
const SKY_TOP_COLOR = '#020812'
const SKY_HORIZON_COLOR = '#17394a'
const CROWD_COLORS = [
  '#1b2c4a',
  '#7a2430',
  '#d8dde6',
  '#c9a227',
  '#2e5d7a',
  '#a34b3c',
  '#e0c98a',
  '#3b7a5e',
  '#e8edf5',
  '#8d3b52',
  '#26506b',
  '#e2b45c',
  '#5d8f79',
  '#b8c6d2',
]

// 5x7 のドットフォント（テクスチャなしで MIKAN を光らせる）
const GLYPHS = {
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10101', '10011', '10001', '10001'],
}

// 外野壁の距離表示用 5x7 数字
const DIGITS = {
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
}

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
function arcSectorGeometry(inner, outer, start, length, segments = 64, radialSegments = 1) {
  const geometry =
    inner > 0.0001
      ? new THREE.RingGeometry(inner, outer, segments, radialSegments, start, length)
      : new THREE.CircleGeometry(outer, segments, start, length)
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

/** 外野スタンド用の扇形（既存の角度範囲） */
function sectorGeometry(inner, outer, segments = 96, radialSegments = 1) {
  return arcSectorGeometry(inner, outer, ARC_START, ARC_LENGTH, segments, radialSegments)
}

/** 決定的な波模様でフィールドに淡い色ムラを付ける（頂点カラー） */
function tintField(geometry, base, alternate, seed = 0) {
  const position = geometry.getAttribute('position')
  const colors = new Float32Array(position.count * 3)
  const from = new THREE.Color(base)
  const to = new THREE.Color(alternate)
  const color = new THREE.Color()
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index)
    const z = position.getZ(index)
    const wave = Math.sin(x * 0.41 + seed) * Math.cos(z * 0.33 - seed * 0.7)
    const blend = 0.18 + 0.14 * wave
    color.copy(from).lerp(to, Math.min(1, Math.max(0, blend)))
    colors[index * 3] = color.r
    colors[index * 3 + 1] = color.g
    colors[index * 3 + 2] = color.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

/** 照明の滲み用ラジアルグラデーション（Canvas を使わない DataTexture） */
function createGlowTexture(size = 64) {
  const data = new Uint8Array(size * size * 4)
  const center = (size - 1) / 2
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot((x - center) / center, (y - center) / center)
      const alpha = Math.pow(Math.max(0, 1 - distance), 2.4)
      const offset = (y * size + x) * 4
      data[offset] = 255
      data[offset + 1] = 255
      data[offset + 2] = 255
      data[offset + 3] = Math.round(alpha * 255)
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
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

  // 共有の単位ジオメトリ。dispose では Set でまとめて破棄する。
  const unitBox = new THREE.BoxGeometry(1, 1, 1)
  const dummy = new THREE.Object3D()

  // フィールドの主要面は PBR。粗くざらついた土と芝、やや硬い白線・パッド。
  function fieldMaterial(color, roughness, options = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...options })
  }

  // 照明と電光掲示の滲み。加算合成なので夜景が白く飞ばないよう弱めに置く。
  const glowTexture = createGlowTexture()
  function haloMaterial(color, opacity) {
    return new THREE.SpriteMaterial({
      map: glowTexture,
      color,
      opacity,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  }
  const warmHalo = haloMaterial('#ffd994', 0.42)
  const coolHalo = haloMaterial('#d7efff', 0.5)
  function halo(parent, material, x, y, z, size) {
    const sprite = new THREE.Sprite(material)
    sprite.position.set(x, y, z)
    sprite.scale.setScalar(size)
    parent.add(sprite)
    return sprite
  }

  /** three.js 座標に箱を置く（大きさはスケールで指定） */
  function box(parent, material, width, height, depth, x, y, z, rotationY = 0) {
    const mesh = new THREE.Mesh(unitBox, material)
    mesh.position.set(x, y, z)
    mesh.scale.set(width, height, depth)
    mesh.rotation.y = rotationY
    parent.add(mesh)
    return mesh
  }

  /** ゲーム座標に箱を置く */
  function gameBox(parent, material, width, height, depth, gx, gy, gz, rotationY = 0) {
    const point = gameVector(gx, gy, gz)
    return box(parent, material, width, height, depth, point.x, point.y, point.z, rotationY)
  }

  /** 繰り返しの箱を 1 ドローコールにまとめる */
  function instanceBoxes(parent, material, specs, name) {
    const mesh = new THREE.InstancedMesh(unitBox, material, specs.length)
    mesh.name = name
    for (let index = 0; index < specs.length; index += 1) {
      const spec = specs[index]
      dummy.position.set(spec.x, spec.y, spec.z)
      dummy.rotation.set(0, spec.rotY || 0, 0)
      dummy.scale.set(spec.w, spec.h, spec.d)
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
      if (spec.color) mesh.setColorAt(index, new THREE.Color(spec.color))
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    parent.add(mesh)
    return mesh
  }

  // --- 空 ---
  group.add(createSkyDome())

  // --- 地面（球場の外側まで続く暗い芝・土） ---
  const groundGeometry = new THREE.CircleGeometry(150, 64)
  groundGeometry.rotateX(-Math.PI / 2)
  const groundMaterial = new THREE.MeshLambertMaterial({ color: '#1c3a29' })
  const ground = new THREE.Mesh(groundGeometry, groundMaterial)
  ground.name = 'ground'
  ground.position.y = -0.02
  ground.receiveShadow = true
  group.add(ground)

  // --- 芝と刈り込み（頂点カラーで淡いムラを出す） ---
  const grassMaterial = fieldMaterial('#ffffff', 0.96, {
    vertexColors: true,
    emissive: '#0d2a17',
    emissiveIntensity: 0.1,
  })
  const mowMaterial = fieldMaterial('#ffffff', 0.98, { vertexColors: true })
  const grass = new THREE.Mesh(
    tintField(sectorGeometry(0, FENCE_RADIUS, 128, 3), GRASS_COLORS[0], GRASS_COLORS[2], 1.2),
    grassMaterial,
  )
  grass.name = 'grass'
  grass.position.y = 0
  grass.receiveShadow = true
  group.add(grass)
  for (let index = 0; index < 9; index += 1) {
    if (index % 2 !== 0) continue
    const inner = 10 * (index + 1)
    const band = new THREE.Mesh(
      tintField(
        sectorGeometry(inner, inner + 10, 96, 2),
        GRASS_COLORS[1],
        GRASS_COLORS[0],
        inner * 0.13 + 3,
      ),
      mowMaterial,
    )
    band.position.y = 0.003 + index * 0.0004
    band.receiveShadow = true
    group.add(band)
  }

  // --- 警告トラック ---
  const trackMaterial = fieldMaterial(TRACK_COLOR, 0.94)
  const track = new THREE.Mesh(sectorGeometry(94, FENCE_RADIUS), trackMaterial)
  track.position.y = 0.012
  track.receiveShadow = true
  group.add(track)

  // --- 内野の土とグラスエッジ ---
  const dirtMaterial = fieldMaterial(DIRT_COLOR, 0.95)
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
  diamond.receiveShadow = true
  group.add(diamond)

  const homeCircleGeometry = new THREE.CircleGeometry(3.6, 32)
  homeCircleGeometry.rotateX(-Math.PI / 2)
  const homeCircle = new THREE.Mesh(homeCircleGeometry, dirtMaterial)
  homeCircle.position.y = 0.028
  homeCircle.receiveShadow = true
  group.add(homeCircle)

  const infieldEdge = new THREE.Mesh(
    arcSectorGeometry(24, 31.5, -0.55, Math.PI + 1.1, 64),
    dirtMaterial,
  )
  infieldEdge.position.y = 0.021
  infieldEdge.receiveShadow = true
  group.add(infieldEdge)

  // 内野土の焦げ目（重ねたリングで色に奥行きを出す）
  const wornDirt = new THREE.Mesh(
    arcSectorGeometry(3.8, 6.4, -0.35, Math.PI + 0.7, 48),
    fieldMaterial('#96704d', 0.96),
  )
  wornDirt.position.y = 0.024
  wornDirt.receiveShadow = true
  group.add(wornDirt)

  // ベースライン（土の帯）
  const pathMaterial = fieldMaterial('#b99569', 0.95)
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
    const path = new THREE.Mesh(unitBox, pathMaterial)
    path.position.copy(gameVector((start.x + end.x) / 2, (start.y + end.y) / 2, 0.026))
    path.rotation.y = Math.atan2(dy, dx)
    path.scale.set(length, 0.02, 0.34)
    path.receiveShadow = true
    group.add(path)
  }

  // --- 白線（打者枠・捕手枠・ベースライン・ coaching box などを 1 バッチで） ---
  const chalkSegments = []
  function chalkLine(ax, ay, bx, by, z = 0.047, width = 0.11) {
    chalkSegments.push({ ax, ay, bx, by, z, width })
  }
  function chalkRect(cx, cy, width, height, z = 0.047) {
    const x0 = cx - width / 2
    const x1 = cx + width / 2
    const y0 = cy - height / 2
    const y1 = cy + height / 2
    chalkLine(x0, y0, x1, y0, z)
    chalkLine(x1, y0, x1, y1, z)
    chalkLine(x1, y1, x0, y1, z)
    chalkLine(x0, y1, x0, y0, z)
  }
  function chalkCircle(cx, cy, radius, z = 0.047, steps = 32, width = 0.1) {
    for (let index = 0; index < steps; index += 1) {
      const a = (index / steps) * Math.PI * 2
      const b = ((index + 1) / steps) * Math.PI * 2
      chalkLine(
        cx + Math.cos(a) * radius,
        cy + Math.sin(a) * radius,
        cx + Math.cos(b) * radius,
        cy + Math.sin(b) * radius,
        z,
        width,
      )
    }
  }

  for (const [start, end] of pathPairs) {
    chalkLine(start.x, start.y, end.x, end.y, 0.049, 0.09)
  }
  chalkRect(-0.95, 0.6, 1.1, 2.6)
  chalkRect(0.95, 0.6, 1.1, 2.6)
  // 打者枠の内側の補助線（本塁に近い位置と中央）
  for (const side of [-1, 1]) {
    chalkLine(side * 0.95 - 0.4, -0.18, side * 0.95 + 0.4, -0.18, 0.05, 0.045)
    chalkLine(side * 0.95 - 0.4, 0.62, side * 0.95 + 0.4, 0.62, 0.05, 0.045)
  }
  chalkRect(0, -2.8, 2.3, 2)
  chalkRect(13.5, 15.5, 2.2, 3.4)
  chalkRect(-13.5, 15.5, 2.2, 3.4)
  chalkCircle(0, 0, 3.6)
  chalkCircle(-7.5, -8.5, 1.8)
  chalkCircle(7.5, -8.5, 1.8)
  chalkCircle(0, FIELD_POINTS.pitcher.y, 2.7, 0.24, 28, 0.08)
  for (let index = 0; index < 40; index += 1) {
    const a = -0.6 + ((Math.PI + 1.2) * index) / 40
    const b = -0.6 + ((Math.PI + 1.2) * (index + 1)) / 40
    chalkLine(Math.cos(a) * 31.5, Math.sin(a) * 31.5, Math.cos(b) * 31.5, Math.sin(b) * 31.5)
  }

  const chalkMaterial = new THREE.MeshStandardMaterial({
    color: '#fffdf0',
    roughness: 0.85,
    metalness: 0,
    emissive: '#fff3d2',
    emissiveIntensity: 0.22,
  })
  const chalk = new THREE.InstancedMesh(unitBox, chalkMaterial, chalkSegments.length)
  chalk.name = 'field-lines'
  chalkSegments.forEach((segment, index) => {
    const dx = segment.bx - segment.ax
    const dy = segment.by - segment.ay
    const length = Math.hypot(dx, dy)
    dummy.position.copy(
      gameVector((segment.ax + segment.bx) / 2, (segment.ay + segment.by) / 2, segment.z),
    )
    dummy.rotation.set(0, Math.atan2(dy, dx), 0)
    dummy.scale.set(length, 0.012, segment.width)
    dummy.updateMatrix()
    chalk.setMatrixAt(index, dummy.matrix)
  })
  chalk.instanceMatrix.needsUpdate = true
  group.add(chalk)

  // --- ホームプレート（五角形） ---
  const plateShape = new THREE.Shape()
  plateShape.moveTo(-0.42, -0.38)
  plateShape.lineTo(0.42, -0.38)
  plateShape.lineTo(0.42, 0.06)
  plateShape.lineTo(0, 0.44)
  plateShape.lineTo(-0.42, 0.06)
  plateShape.closePath()
  const plateGeometry = new THREE.ShapeGeometry(plateShape)
  plateGeometry.rotateX(-Math.PI / 2)
  // プレートの縁を少し暗くして輪郭をはっきりさせる
  const plateEdge = new THREE.Mesh(plateGeometry, fieldMaterial('#b9b5a4', 0.9))
  plateEdge.position.copy(gameVector(0, 0, 0.051))
  plateEdge.scale.set(1.09, 1, 1.09)
  group.add(plateEdge)

  const plate = new THREE.Mesh(
    plateGeometry,
    fieldMaterial('#fffff8', 0.55, {
      emissive: '#e8e4cf',
      emissiveIntensity: 0.18,
    }),
  )
  plate.position.copy(gameVector(0, 0, 0.055))
  plate.receiveShadow = true
  group.add(plate)

  // --- マウンドとピッチングラバー ---
  const moundMaterial = fieldMaterial('#a7835b', 0.95)
  const mound = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.8, 0.24, 40), moundMaterial)
  mound.position.copy(gameVector(0, FIELD_POINTS.pitcher.y, 0.12))
  mound.receiveShadow = true
  group.add(mound)
  const moundTop = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.1, 0.03, 32),
    fieldMaterial('#b7956a', 0.92),
  )
  moundTop.position.copy(gameVector(0, FIELD_POINTS.pitcher.y, 0.25))
  moundTop.receiveShadow = true
  group.add(moundTop)
  const rubberMaterial = fieldMaterial('#f4f4ee', 0.7, {
    emissive: '#cfcdbb',
    emissiveIntensity: 0.15,
  })
  gameBox(group, rubberMaterial, 0.65, 0.04, 0.2, 0, FIELD_POINTS.pitcher.y, 0.28)

  // --- 塁（わずかに面取りした二重の白いブロック） ---
  const baseSpecs = [FIELD_POINTS.first, FIELD_POINTS.second, FIELD_POINTS.third].map((base) => ({
    x: gameVector(base.x, base.y, 0).x,
    y: 0.045,
    z: gameVector(base.x, base.y, 0).z,
    rotY: Math.PI / 4,
    w: 0.48,
    h: 0.07,
    d: 0.48,
  }))
  instanceBoxes(
    group,
    fieldMaterial('#5b5347', 0.9),
    baseSpecs.map((spec) => ({ ...spec, y: 0.035, w: 0.57, d: 0.57 })),
    'base-outlines',
  )
  const baseMaterial = fieldMaterial('#f2f2e9', 0.62, {
    emissive: '#dedaca',
    emissiveIntensity: 0.15,
  })
  instanceBoxes(group, baseMaterial, baseSpecs, 'bases')
  instanceBoxes(
    group,
    fieldMaterial('#fffffb', 0.5),
    baseSpecs.map((spec) => ({ ...spec, y: 0.085, w: 0.32, d: 0.32 })),
    'base-tops',
  )

  // --- ファウルライン ---
  const foulPositions = []
  for (const pole of [FOUL_POLES.left, FOUL_POLES.right]) {
    foulPositions.push(0, 0.05, 0, pole.x, 0.05, -pole.y)
  }
  const foulGeometry = new THREE.BufferGeometry()
  foulGeometry.setAttribute('position', new THREE.Float32BufferAttribute(foulPositions, 3))
  const foulMaterial = new THREE.LineBasicMaterial({ color: '#fffdf0' })
  group.add(new THREE.LineSegments(foulGeometry, foulMaterial))

  // --- 外野フェンス、パッド、天端 ---
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
  const fenceMaterial = fieldMaterial(FENCE_COLOR, 0.78, { side: THREE.DoubleSide })
  const fence = new THREE.Mesh(fenceGeometry, fenceMaterial)
  fence.position.y = FENCE_HEIGHT / 2
  fence.receiveShadow = true
  group.add(fence)

  const padding = new THREE.Mesh(
    new THREE.CylinderGeometry(
      FENCE_RADIUS - 0.4,
      FENCE_RADIUS - 0.4,
      1.3,
      96,
      1,
      true,
      ARC_START + Math.PI / 2,
      ARC_LENGTH,
    ),
    fieldMaterial(PADDING_COLOR, 0.88, { side: THREE.DoubleSide }),
  )
  padding.position.y = 0.65
  padding.receiveShadow = true
  group.add(padding)

  const railGeometry = new THREE.TorusGeometry(FENCE_RADIUS, 0.13, 8, 96, ARC_LENGTH)
  railGeometry.rotateX(-Math.PI / 2)
  const railMaterial = new THREE.MeshLambertMaterial({
    color: RAIL_COLOR,
    emissive: RAIL_COLOR,
    emissiveIntensity: 0.16,
  })
  const rail = new THREE.Mesh(railGeometry, railMaterial)
  rail.position.y = FENCE_HEIGHT
  rail.rotation.y = ARC_START
  group.add(rail)

  // フェンスの支柱と距離表示プレート（インスタンス 1 本）
  const wallDetails = []
  for (let index = 0; index <= 28; index += 1) {
    const angle = ARC_START + (ARC_LENGTH * index) / 28
    const radius = FENCE_RADIUS - 0.55
    wallDetails.push({
      x: Math.cos(angle) * radius,
      y: 1.7,
      z: -Math.sin(angle) * radius,
      rotY: angle,
      w: 0.16,
      h: 3.4,
      d: 0.16,
      color: '#26424b',
    })
  }
  // 外野壁の距離表示（プレート＋5x7 ドットの数字）
  const distanceSpecs = []
  const distances = ['100', '105', '110', '115', '120', '125', '130', '135']
  for (let index = 0; index < 8; index += 1) {
    const angle = ARC_START + (ARC_LENGTH * (index + 0.5)) / 8
    const radius = FENCE_RADIUS - 0.75
    wallDetails.push({
      x: Math.cos(angle) * radius,
      y: 2.2,
      z: -Math.sin(angle) * radius,
      rotY: angle + Math.PI / 2,
      w: 2,
      h: 0.95,
      d: 0.12,
      color: '#f0d98a',
    })
    const tx = -Math.sin(angle)
    const tz = -Math.cos(angle)
    const dotRadius = radius - 0.12
    const label = distances[index]
    for (let digitIndex = 0; digitIndex < label.length; digitIndex += 1) {
      const rows = DIGITS[label[digitIndex]]
      rows.forEach((row, rowIndex) => {
        for (let column = 0; column < row.length; column += 1) {
          if (row[column] !== '1') continue
          const offset = (digitIndex - 1) * 0.62 + (column - 2) * 0.1
          distanceSpecs.push({
            x: Math.cos(angle) * dotRadius + tx * offset,
            y: 2.2 + (3 - rowIndex) * 0.1,
            z: -Math.sin(angle) * dotRadius + tz * offset,
            rotY: angle + Math.PI / 2,
            w: 0.075,
            h: 0.075,
            d: 0.06,
          })
        }
      })
    }
  }
  instanceBoxes(group, railMaterial, wallDetails, 'wall-details')
  instanceBoxes(
    group,
    new THREE.MeshLambertMaterial({ color: '#14252b' }),
    distanceSpecs,
    'wall-distance-markers',
  )

  // --- ファウルポールとバスケット ---
  const poleMaterial = new THREE.MeshLambertMaterial({
    color: RAIL_COLOR,
    emissive: RAIL_COLOR,
    emissiveIntensity: 0.22,
  })
  const foulPoleGeometry = new THREE.CylinderGeometry(0.18, 0.22, 12, 12)
  const basketSpecs = []
  for (const pole of [FOUL_POLES.left, FOUL_POLES.right]) {
    const point = gameVector(pole.x, pole.y, 6)
    const mesh = new THREE.Mesh(foulPoleGeometry, poleMaterial)
    mesh.position.copy(point)
    group.add(mesh)

    const radius = Math.hypot(point.x, point.z)
    const ux = point.x / radius
    const uz = point.z / radius
    const tx = -uz
    const tz = ux
    const rotY = Math.atan2(-tz, tx)
    for (const side of [-1, 1]) {
      basketSpecs.push({
        x: point.x + tx * side * 0.95,
        y: 8.2,
        z: point.z + tz * side * 0.95,
        rotY,
        w: 0.12,
        h: 2.4,
        d: 0.12,
      })
    }
    for (const height of [7.05, 9.35]) {
      basketSpecs.push({ x: point.x, y: height, z: point.z, rotY, w: 2, h: 0.12, d: 0.12 })
    }
  }
  instanceBoxes(group, poleMaterial, basketSpecs, 'foul-baskets')

  // --- スタンド（段状の観客席） ---
  const standMaterial = new THREE.MeshLambertMaterial({ color: STAND_COLOR })
  const aisleMaterial = new THREE.MeshLambertMaterial({ color: CONCRETE_COLOR })
  // 段状の観客席は同じ材質なので 1 メッシュにまとめて描画回数を抑える
  const standGeometries = []
  const tiers = []
  const tierWidth = (STAND_OUTER - STAND_INNER) / STAND_TIERS
  for (let index = 0; index < STAND_TIERS; index += 1) {
    const inner = STAND_INNER + tierWidth * index
    const outer = inner + tierWidth + 0.08
    const height = 1.8 + index * 2
    tiers.push({ inner, outer, y: height })
    const tierGeometry = sectorGeometry(inner, outer, 48)
    tierGeometry.translate(0, height, 0)
    standGeometries.push(tierGeometry)
  }
  const standBack = new THREE.Mesh(
    new THREE.CylinderGeometry(
      STAND_OUTER + 0.4,
      STAND_OUTER + 0.4,
      17,
      64,
      1,
      true,
      ARC_START + Math.PI / 2,
      ARC_LENGTH,
    ),
    standMaterial,
  )
  standBack.position.y = 8.5
  group.add(standBack)

  // --- 観客（インスタンス化した色ブロック） ---
  const crowdGeometry = new THREE.PlaneGeometry(0.45, 0.55)
  const crowdMaterial = new THREE.MeshLambertMaterial({
    color: '#ffffff',
    side: THREE.DoubleSide,
  })
  const crowd = new THREE.InstancedMesh(crowdGeometry, crowdMaterial, CROWD_COUNT)
  crowd.name = 'crowd'
  const palette = CROWD_COLORS.map((color) => new THREE.Color(color))
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
    crowd.setColorAt(index, palette[Math.floor(random() * palette.length)])
  }
  crowd.instanceMatrix.needsUpdate = true
  if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true
  group.add(crowd)

  // --- バックネット裏まで回り込む外野スタンド ---
  const backTiers = []
  for (let index = 0; index < STAND_TIERS; index += 1) {
    const inner = STAND_INNER + tierWidth * index
    const outer = inner + tierWidth + 0.08
    const height = 1.8 + index * 2
    backTiers.push({ inner, outer, y: height })
    const tierGeometry = arcSectorGeometry(inner, outer, BACKSTAND_START, BACKSTAND_LENGTH, 64)
    tierGeometry.translate(0, height, 0)
    standGeometries.push(tierGeometry)
  }
  const backStandBack = new THREE.Mesh(
    new THREE.CylinderGeometry(
      STAND_OUTER + 0.4,
      STAND_OUTER + 0.4,
      17,
      80,
      1,
      true,
      BACKSTAND_START + Math.PI / 2,
      BACKSTAND_LENGTH,
    ),
    standMaterial,
  )
  backStandBack.position.y = 8.5
  group.add(backStandBack)

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
    backCrowd.setColorAt(index, palette[Math.floor(backRandom() * palette.length)])
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
    const height = 1.2 + index * 1.5
    backstopTiers.push({ inner, outer, y: height })
    const tierGeometry = arcSectorGeometry(
      inner,
      outer,
      BACKSTOP_STAND_START,
      BACKSTOP_STAND_LENGTH,
      64,
    )
    tierGeometry.translate(0, height, 0)
    standGeometries.push(tierGeometry)
  }
  const stands = new THREE.Mesh(mergeGeometries(standGeometries), standMaterial)
  stands.name = 'stand-tiers'
  group.add(stands)
  for (const geometry of standGeometries) geometry.dispose()
  const backstopStandBack = new THREE.Mesh(
    new THREE.CylinderGeometry(
      BACKSTOP_STAND_OUTER + 0.4,
      BACKSTOP_STAND_OUTER + 0.4,
      8,
      48,
      1,
      true,
      BACKSTOP_STAND_START + Math.PI / 2,
      BACKSTOP_STAND_LENGTH,
    ),
    standMaterial,
  )
  backstopStandBack.position.y = 4
  group.add(backstopStandBack)

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
    backstopCrowd.setColorAt(index, palette[Math.floor(backstopRandom() * palette.length)])
  }
  backstopCrowd.instanceMatrix.needsUpdate = true
  if (backstopCrowd.instanceColor) backstopCrowd.instanceColor.needsUpdate = true
  group.add(backstopCrowd)

  // --- 座席の通路（階段） ---
  const aisleSpecs = []
  function addAisles(angleList, levelTiers) {
    for (const angle of angleList) {
      for (const tier of levelTiers) {
        const radius = (tier.inner + tier.outer) / 2
        aisleSpecs.push({
          x: Math.cos(angle) * radius,
          y: tier.y + 0.035,
          z: -Math.sin(angle) * radius,
          rotY: angle,
          w: tier.outer - tier.inner + 0.2,
          h: 0.07,
          d: 0.42,
        })
      }
    }
  }
  addAisles(
    Array.from({ length: 12 }, (_, index) => ARC_START + (ARC_LENGTH * (index + 0.5)) / 12),
    tiers,
  )
  addAisles(
    Array.from(
      { length: 12 },
      (_, index) => BACKSTAND_START + (BACKSTAND_LENGTH * (index + 0.5)) / 12,
    ),
    backTiers,
  )
  addAisles(
    Array.from(
      { length: 6 },
      (_, index) => BACKSTOP_STAND_START + (BACKSTOP_STAND_LENGTH * (index + 0.5)) / 6,
    ),
    backstopTiers,
  )
  instanceBoxes(group, aisleMaterial, aisleSpecs, 'stand-aisles')

  // --- スタンドの手すり ---
  const upperRail = new THREE.Mesh(
    new THREE.TorusGeometry(STAND_OUTER + 0.3, 0.16, 6, 96, ARC_LENGTH),
    railMaterial,
  )
  upperRail.geometry.rotateX(-Math.PI / 2)
  upperRail.position.y = 16.2
  upperRail.rotation.y = ARC_START
  group.add(upperRail)
  const backUpperRail = new THREE.Mesh(
    new THREE.TorusGeometry(STAND_OUTER + 0.3, 0.16, 6, 80, BACKSTAND_LENGTH),
    railMaterial,
  )
  backUpperRail.geometry.rotateX(-Math.PI / 2)
  backUpperRail.position.y = 16.2
  backUpperRail.rotation.y = BACKSTAND_START
  group.add(backUpperRail)

  // --- Upper deck の屋根・トラス・旗 ---
  const canopyMaterial = new THREE.MeshLambertMaterial({
    color: '#101f29',
    side: THREE.DoubleSide,
  })
  const canopy = new THREE.Mesh(
    arcSectorGeometry(126, 148, ARC_START - 0.06, ARC_LENGTH + 0.12, 64),
    canopyMaterial,
  )
  canopy.position.y = 21
  group.add(canopy)
  const backCanopy = new THREE.Mesh(
    arcSectorGeometry(126, 148, BACKSTAND_START - 0.06, BACKSTAND_LENGTH + 0.12, 64),
    canopyMaterial,
  )
  backCanopy.position.y = 21
  group.add(backCanopy)

  const trussSpecs = []
  const flagSpecs = []
  for (let index = 0; index <= 14; index += 1) {
    const angle = ARC_START + (ARC_LENGTH * index) / 14
    const radius = 133
    const x = Math.cos(angle) * radius
    const z = -Math.sin(angle) * radius
    trussSpecs.push({ x, y: 18.6, z, rotY: angle, w: 0.24, h: 4.8, d: 0.24 })
    if (index % 2 === 0) {
      flagSpecs.push({
        x,
        y: 22.7,
        z,
        rotY: angle,
        w: 1.1,
        h: 0.7,
        d: 0.06,
        color: index % 4 === 0 ? '#e6d36a' : '#4a90d9',
      })
    }
  }
  instanceBoxes(group, canopyMaterial, trussSpecs, 'roof-trusses')
  instanceBoxes(group, railMaterial, flagSpecs, 'roof-flags')

  // --- スタンド下のトンネル入口 ---
  const tunnelSpecs = []
  const tunnelGlowSpecs = []
  for (const angle of [
    ARC_START + 0.25,
    ARC_START + ARC_LENGTH * 0.35,
    ARC_START + ARC_LENGTH * 0.65,
    BACKSTAND_START + BACKSTAND_LENGTH * 0.5,
  ]) {
    const radius = STAND_INNER - 1.2
    const x = Math.cos(angle) * radius
    const z = -Math.sin(angle) * radius
    tunnelSpecs.push({ x, y: 1.5, z, rotY: angle, w: 4.2, h: 3, d: 0.4 })
    tunnelGlowSpecs.push({ x, y: 3.15, z, rotY: angle, w: 4.4, h: 0.14, d: 0.2 })
  }
  instanceBoxes(group, canopyMaterial, tunnelSpecs, 'tunnels')
  instanceBoxes(group, railMaterial, tunnelGlowSpecs, 'tunnel-glow')

  // --- ダグアウト（屋根付き・選手のシルエット入り） ---
  const dugoutMaterial = new THREE.MeshLambertMaterial({ color: '#122630' })
  const seatMaterial = new THREE.MeshLambertMaterial({ color: '#ffffff' })
  const dugoutSeats = []
  const dugoutAccents = []
  for (const side of [1, -1]) {
    const root = new THREE.Group()
    const point = gameVector(side * 16.5, 9.5, 0)
    root.position.set(point.x, 0, point.z)
    root.rotation.y = side > 0 ? Math.PI / 4 : (Math.PI * 3) / 4
    group.add(root)
    box(root, dugoutMaterial, 14, 0.18, 4.4, 0, 0.09, 0)
    box(root, dugoutMaterial, 14, 2.2, 0.22, 0, 1.2, -2.1)
    box(root, dugoutMaterial, 14.6, 0.26, 5, 0, 2.45, -0.1)
    box(root, dugoutMaterial, 0.22, 2.2, 4.4, -7, 1.2, 0)
    box(root, dugoutMaterial, 0.22, 2.2, 4.4, 7, 1.2, 0)
    box(root, railMaterial, 14, 0.1, 0.12, 0, 1, 2.15)
    // 手すりの支柱とチームカラーの帯（ダグアウトを遠くでも判別しやすくする）
    instanceBoxes(
      root,
      railMaterial,
      Array.from({ length: 8 }, (_, index) => ({
        x: -7 + index * 2,
        y: 0.55,
        z: 2.15,
        w: 0.08,
        h: 1.1,
        d: 0.08,
      })),
      side > 0 ? 'dugout-rails-home' : 'dugout-rails-away',
    )
    const accentColor = side > 0 ? homeColor : awayColor
    const accentMaterial = new THREE.MeshLambertMaterial({
      color: accentColor,
      emissive: accentColor,
      emissiveIntensity: 0.22,
    })
    instanceBoxes(
      root,
      accentMaterial,
      [
        { x: 0, y: 2.53, z: 2.3, w: 14.4, h: 0.12, d: 0.12 },
        { x: 0, y: 1.14, z: 2.16, w: 14, h: 0.14, d: 0.1 },
      ],
      side > 0 ? 'dugout-accent-home' : 'dugout-accent-away',
    )
    dugoutAccents.push({ material: accentMaterial, side })
    const seats = []
    for (let index = 0; index < 12; index += 1) {
      seats.push({
        x: -6 + index * 1.1,
        y: 0.7,
        z: 0.95,
        w: 0.36,
        h: 0.85,
        d: 0.36,
        color: side > 0 ? homeColor : awayColor,
      })
    }
    const seatMesh = instanceBoxes(
      root,
      seatMaterial,
      seats,
      side > 0 ? 'dugout-home' : 'dugout-away',
    )
    dugoutSeats.push({ mesh: seatMesh, side })
  }

  // --- ブルペン（マウンドと防球スクリーン） ---
  const screenMaterial = new THREE.MeshBasicMaterial({
    color: '#7b9aa1',
    transparent: true,
    opacity: 0.13,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  for (const angle of [0.5, Math.PI - 0.5]) {
    const center = gameVector(Math.cos(angle) * 72, Math.sin(angle) * 72, 0)
    const moundPen = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.5, 0.18, 20), moundMaterial)
    moundPen.position.set(center.x, 0.09, center.z)
    group.add(moundPen)
    const screen = new THREE.Mesh(unitBox, screenMaterial)
    screen.position.set(center.x, 1.35, center.z - 4)
    screen.scale.set(6, 2.7, 0.08)
    screen.rotation.y = angle - Math.PI / 2
    group.add(screen)
    const penSpecs = []
    for (let index = 0; index < 5; index += 1) {
      penSpecs.push({
        x: center.x + (index - 2) * 0.9,
        y: 0.55,
        z: center.z - 3,
        w: 0.35,
        h: 0.8,
        d: 0.35,
        color: index % 2 === 0 ? '#d8dde6' : '#c9a227',
      })
    }
    instanceBoxes(group, seatMaterial, penSpecs, 'bullpen-players')
  }

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
  const backCanopyStructure = new THREE.Mesh(new THREE.BoxGeometry(34, 0.7, 10), soffitMaterial)
  backCanopyStructure.position.set(0, 11.2, 104)
  structure.add(backCanopyStructure)

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
    halo(structure, coolHalo, x, 10.2, 99.4, 7)
  }
  for (const y of [1.2, 8.8]) {
    box(structure, backLightMaterial, 66, 0.12, 0.3, 0, y, 111)
  }

  const signageMaterial = new THREE.MeshLambertMaterial({
    color: '#f5a524',
    emissive: '#f5a524',
    emissiveIntensity: 0.5,
  })
  const signage = new THREE.Mesh(new THREE.BoxGeometry(32, 0.8, 0.4), signageMaterial)
  signage.position.set(0, 10.6, 103)
  structure.add(signage)
  halo(structure, warmHalo, 0, 10.6, 102.5, 11)

  const pylonMaterial = new THREE.MeshLambertMaterial({ color: '#101f27' })
  for (const x of [-14.5, 14.5]) {
    const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, 11, 8), pylonMaterial)
    pylon.position.set(x, 5.5, 14)
    structure.add(pylon)
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.2, 0.5), backLightMaterial)
    lamp.position.set(x, 10.7, 14)
    structure.add(lamp)
    halo(structure, coolHalo, x, 10.7, 13.5, 5)
  }
  group.add(structure)

  // --- 照明塔（電球の粒もインスタンス化） ---
  const towerGeometry = new THREE.CylinderGeometry(0.35, 0.62, 30, 10)
  const towerMaterial = new THREE.MeshLambertMaterial({ color: '#243440' })
  const lampGeometry = new THREE.BoxGeometry(7, 3.4, 0.8)
  const lampMaterial = new THREE.MeshLambertMaterial({
    color: '#eef7ff',
    emissive: '#dff1ff',
    emissiveIntensity: 1.6,
  })
  const lampCells = []
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
    halo(group, coolHalo, lamp.position.x, lamp.position.y, lamp.position.z, 13)
    const facing = Math.atan2(-x, -depth)
    for (let row = 0; row < 2; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        lampCells.push({
          x: x + Math.cos(facing) * (column - 1.5) * 1.5,
          y: 31.2 + row * 0.9,
          z: -depth + Math.sin(facing) * (column - 1.5) * 1.5,
          rotY: facing,
          w: 1.1,
          h: 0.55,
          d: 0.12,
        })
      }
    }
  }
  instanceBoxes(group, lampMaterial, lampCells, 'lamp-cells')

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
    emissiveIntensity: 0.6,
  })
  scoreboard.add(new THREE.Mesh(new THREE.BoxGeometry(26, 9, 0.9), panelMaterial))
  const homeAccentMaterial = new THREE.MeshLambertMaterial({
    color: teamColors.home,
    emissive: teamColors.home,
    emissiveIntensity: 0.45,
  })
  const awayAccentMaterial = new THREE.MeshLambertMaterial({
    color: teamColors.away,
    emissive: teamColors.away,
    emissiveIntensity: 0.45,
  })
  const accentGeometry = new THREE.BoxGeometry(9, 0.8, 0.4)
  const homeAccent = new THREE.Mesh(accentGeometry, homeAccentMaterial)
  homeAccent.position.set(-8, -3.9, 0.65)
  scoreboard.add(homeAccent)
  const awayAccent = new THREE.Mesh(accentGeometry, awayAccentMaterial)
  awayAccent.position.set(8, -3.9, 0.65)
  scoreboard.add(awayAccent)

  // スコアボードの発光フレームと表示セル
  const glowMaterial = new THREE.MeshLambertMaterial({
    color: '#b8e7ff',
    emissive: '#8fd4ff',
    emissiveIntensity: 0.9,
  })
  for (const x of [-13.2, 13.2]) {
    box(scoreboard, glowMaterial, 0.16, 10.8, 0.3, x, 0, 0.5)
  }
  for (const y of [-5.1, 5.1]) {
    box(scoreboard, glowMaterial, 26.4, 0.16, 0.3, 0, y, 0.5)
  }
  const cellSpecs = []
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 9; column += 1) {
      cellSpecs.push({
        x: -10 + column * 2.5,
        y: 3 - row * 2.4,
        z: 0.52,
        w: 1.7,
        h: 1.2,
        d: 0.08,
        color: row === 0 ? '#f5c96b' : '#6fb7c9',
      })
    }
  }
  instanceBoxes(scoreboard, glowMaterial, cellSpecs, 'scoreboard-cells')
  group.add(scoreboard)

  // --- ジャンボトロン（ジオメトリだけで光る MIKAN サイン） ---
  const jumbotron = new THREE.Group()
  jumbotron.name = 'jumbotron'
  jumbotron.position.copy(gameVector(0, 132, 25))
  box(jumbotron, frameMaterial, 23, 10.5, 1.4, 0, 0, 0)
  box(jumbotron, panelMaterial, 21, 8.5, 0.8, 0, 0, 0.8)
  for (const x of [-10.8, 10.8]) {
    box(jumbotron, glowMaterial, 0.18, 9.8, 0.3, x, 0, 1.1)
  }
  for (const y of [-4.2, 4.2]) {
    box(jumbotron, glowMaterial, 21.6, 0.14, 0.3, 0, y, 1.1)
  }
  halo(jumbotron, warmHalo, 0, 0, 1.05, 15)
  const dotSpecs = []
  const dotPitch = 0.34
  const word = 'MIKAN'
  let cursor = -((word.length * 5 * dotPitch - dotPitch) / 2)
  for (const letter of word) {
    const rows = GLYPHS[letter]
    rows.forEach((row, rowIndex) => {
      for (let column = 0; column < row.length; column += 1) {
        if (row[column] !== '1') continue
        dotSpecs.push({
          x: cursor + column * dotPitch,
          y: (3 - rowIndex) * dotPitch,
          z: 1.35,
          w: 0.22,
          h: 0.22,
          d: 0.16,
        })
      }
    })
    cursor += 6 * dotPitch
  }
  const dotMaterial = new THREE.MeshLambertMaterial({
    color: '#ffe9a8',
    emissive: '#ffc94a',
    emissiveIntensity: 1.8,
  })
  const dots = instanceBoxes(jumbotron, dotMaterial, dotSpecs, 'jumbotron-mikan')
  group.add(jumbotron)

  /** チームカラーの差し色を更新する */
  function setTeamColors({ home, away } = {}) {
    if (typeof home === 'string') teamColors.home = home
    if (typeof away === 'string') teamColors.away = away
    homeAccentMaterial.color.set(teamColors.home)
    homeAccentMaterial.emissive.set(teamColors.home)
    awayAccentMaterial.color.set(teamColors.away)
    awayAccentMaterial.emissive.set(teamColors.away)
    for (const { material, side } of dugoutAccents) {
      const color = side > 0 ? teamColors.home : teamColors.away
      material.color.set(color)
      material.emissive.set(color)
    }
    for (const { mesh, side } of dugoutSeats) {
      const color = new THREE.Color(side > 0 ? teamColors.home : teamColors.away)
      for (let index = 0; index < mesh.count; index += 1) mesh.setColorAt(index, color)
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  /** 照明のわずかな揺らぎだけを更新する（毎フレームでも軽い） */
  function update(elapsedSeconds = 0) {
    const pulse = 1.55 + Math.sin(elapsedSeconds * 0.7) * 0.08
    lampMaterial.emissiveIntensity = pulse
    dotMaterial.emissiveIntensity = 1.65 + Math.sin(elapsedSeconds * 1.3) * 0.2
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

  // ジャンボトロンのドット数を更新後も参照できるようにしておく
  dots.count = dotSpecs.length

  return { group, setTeamColors, update, dispose }
}
