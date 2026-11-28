/**
 * three.js による試合ビュー。
 *
 * 旧 Canvas 2D レンダラーと同じ公開 API・アニメーション挙動を保ちつつ、
 * 球場・選手リグ・ボールを実 3D で描画する。
 * main.js は操作のたびに画面 HTML を作り直すため、WebGL の canvas は
 * setCanvas() で使い回し、GPU リソースの再構築を避ける。
 */

import * as THREE from 'three'
import { CAMERA_PRESETS } from '../../game/camera.js'
import { BASE_POSITIONS, FIELD_POINTS, FIELDER_POSITIONS } from '../../game/field.js'
import {
  BALL_RADIUS,
  HIT_FLIGHT_MS,
  PITCH_FLIGHT_MS,
  hitArcHeight,
  hitPoint,
  hitStart,
  hitTargetFor,
  pitchPoint,
} from '../../game/ballFlight.js'
import { createStadium } from './stadium.js'
import { createPlayerRig, placeRig } from './players.js'
import { setFromGame, toThree } from './coords.js'
import { createContactEffect } from './effects.js'
import { getQualityProfile } from './quality.js'
import {
  cameraSettled,
  dramaticHitPreset,
  punchPreset,
  stepCamera,
  viewPresetForPhase,
} from './cameraRig.js'

const FALLBACK_WIDTH = 640
const FALLBACK_HEIGHT = 360
const TRAIL_MAX = 24
const TRAIL_WINDOW_MS = 260
const SWING_MS = 380
const FOLLOW_THROUGH_MS = 240
const CONTACT_PUNCH_MS = 260
const BATTER_BOX_X = 0.62
const RUN_OUT_FRACTION = 0.24
const DEFAULT_DEFENSE_COLOR = '#4a90d9'
const DEFAULT_OFFENSE_COLOR = '#f5a524'

// 高品質モードの適応解像度。描画が重ければ DPR を下げ、余裕があれば戻す。
const ADAPT_DOWN_FRAMES = 45
const ADAPT_UP_FRAMES = 120
const ADAPT_DOWN_MS = 24
const ADAPT_UP_MS = 12
const ADAPT_STEP = 0.15
const ADAPT_FLOOR = 0.8
const ADAPT_COOLDOWN_MS = 2000

/** 数値を 0〜1 に丸める */
function clamp01(value) {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** カメラ設定のディープコピー */
function copyPreset(preset) {
  return {
    position: { ...preset.position },
    target: { ...preset.target },
    fov: preset.fov,
  }
}

/** キャンバスにテキストを描いたテクスチャを作る */
function createTextTexture(text, options = {}) {
  const {
    font = '700 48px system-ui, sans-serif',
    color = '#f5e7c8',
    background = 'rgba(6, 16, 26, 0.72)',
    padding = 22,
    glow = 0,
    scale = 1,
  } = options

  // フォント・余白・発光をまとめて拡大すると、アスペクト比（＝画面上の表示サイズ）は変わらず
  // テクスチャの解像度だけが上がる。
  const ratio = Number.isFinite(scale) && scale > 0 ? scale : 1
  const scaledFont = font.replace(/(\d+(?:\.\d+)?)px/, (_, size) => `${Math.round(size * ratio)}px`)
  const scaledPadding = padding * ratio

  const measureCanvas = document.createElement('canvas')
  const measure = measureCanvas.getContext('2d')
  measure.font = scaledFont
  const fontSize = Number((scaledFont.match(/(\d+(?:\.\d+)?)px/) || [])[1] || 48)
  const baseHeight = Math.ceil(fontSize * 1.2)
  const width = Math.max(32, Math.ceil(measure.measureText(text).width + scaledPadding * 2))
  const height = Math.ceil(baseHeight + scaledPadding * 2)

  const textureCanvas = document.createElement('canvas')
  textureCanvas.width = width
  textureCanvas.height = height
  const context = textureCanvas.getContext('2d')

  if (background) {
    context.fillStyle = background
    context.beginPath()
    context.roundRect(0, 0, width, height, 14 * ratio)
    context.fill()
  }

  context.font = scaledFont
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillStyle = color
  if (glow > 0) {
    context.shadowColor = color
    context.shadowBlur = glow * ratio
  }
  context.fillText(text, width / 2, height / 2)

  const texture = new THREE.CanvasTexture(textureCanvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return { texture, aspect: width / height }
}

/** ボールの発光テクスチャ（高品質では 256px で描画する） */
function createGlowTexture(size) {
  const textureCanvas = document.createElement('canvas')
  textureCanvas.width = size
  textureCanvas.height = size
  const context = textureCanvas.getContext('2d')
  const half = size / 2
  const gradient = context.createRadialGradient(half, half, 0, half, half, half)
  gradient.addColorStop(0, 'rgba(255, 253, 240, 0.98)')
  gradient.addColorStop(0.32, 'rgba(255, 247, 210, 0.6)')
  gradient.addColorStop(0.68, 'rgba(255, 226, 150, 0.16)')
  gradient.addColorStop(1, 'rgba(255, 226, 150, 0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(textureCanvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** 打者の利き手を teams の打順から推定する（不明なら右打ち） */
function battingHand(current) {
  const offense = current.isTopHalf ? 'away' : 'home'
  const index = current.batterIndex?.[offense] ?? 0
  const starters = current.teams?.[offense]?.starters ?? []
  const slot = starters[index % Math.max(1, starters.length)]
  return slot?.player?.bats ?? 'right'
}

/** リグの向き（three.js の +z が正面）をゲーム座標の目標点から求める */
function facingY({ x, y, faceX, faceY }) {
  const dx = faceX - x
  const dy = faceY - y
  if (dx === 0 && dy === 0) return 0
  return Math.atan2(dx, -dy)
}

export function createMatchView(initialCanvas) {
  const quality = getQualityProfile()
  let pixelRatio = quality.pixelRatio
  let canvas = initialCanvas
  let renderer = null
  let context2d = null
  let scene = null
  let camera = null
  let stadium = null
  let ball = null
  let trailLine = null
  let trailGeometry = null
  let landingMarker = null
  let contactEffect = null
  let strikeZone = null
  let homeRunSprite = null
  let pitchTextSprite = null

  let state = null
  let running = false
  let frame = 0
  let lastFrameTime = 0
  let lastRenderAt = 0
  let needsRender = true
  let lastLogLength = null
  let animation = null
  let swingAt = Infinity
  let swingUntil = 0
  let stumbleUntil = 0
  let punchUntil = 0
  let landingAt = 0
  let viewWidth = 0
  let viewHeight = 0
  const renderSamples = []
  let lastAdjustAt = 0
  let lastRenderMs = 0
  let cameraPreset = copyPreset(CAMERA_PRESETS.field)
  let actorSignature = ''
  let stadiumKey = ''
  let pitchTextValue = ''
  let destroyed = false

  const actors = new Map()
  const trailSamples = []
  const textures = new Set()
  const spriteMaterials = new Set()
  const trailPositions = new Float32Array(TRAIL_MAX * 3)

  // --- レンダラー -------------------------------------------------------------

  function createRenderer() {
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: quality.antialias,
        powerPreference: 'high-performance',
      })
      renderer.setPixelRatio(pixelRatio)
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = quality.exposure
      renderer.shadowMap.enabled = quality.shadows
      // three r187 では PCFSoftShadowMap が廃止されたため、PCF シャドウを使う
      if (quality.shadows) renderer.shadowMap.type = THREE.PCFShadowMap
      canvas.dataset.quality = quality.mode
      canvas.dataset.pixelRatio = String(pixelRatio)
      return true
    } catch {
      renderer = null
      return false
    }
  }

  function setupFallback() {
    try {
      context2d = canvas.getContext('2d')
    } catch {
      context2d = null
    }
  }

  function drawFallback() {
    const width = canvas.clientWidth || FALLBACK_WIDTH
    const height = canvas.clientHeight || FALLBACK_HEIGHT
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    if (!context2d) return

    const gradient = context2d.createLinearGradient(0, 0, 0, height)
    gradient.addColorStop(0, '#020812')
    gradient.addColorStop(0.55, '#0b1b2c')
    gradient.addColorStop(1, '#0a1c16')
    context2d.fillStyle = gradient
    context2d.fillRect(0, 0, width, height)

    context2d.fillStyle = '#f5e7c8'
    context2d.font = '700 20px system-ui, sans-serif'
    context2d.textAlign = 'center'
    context2d.textBaseline = 'middle'
    context2d.fillText('3Dフィールド', width / 2, height / 2)
  }

  // --- シーン構築 -------------------------------------------------------------

  function trackSpriteMaterial(material) {
    spriteMaterials.add(material)
    return material
  }

  // 画面空間オーバーレイ用スプライト（sizeAttenuation: false で距離に依らず一定サイズ）
  function createOverlaySprite(texture, aspect) {
    const material = trackSpriteMaterial(
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        sizeAttenuation: false,
      }),
    )
    const sprite = new THREE.Sprite(material)
    sprite.userData.aspect = aspect
    sprite.renderOrder = 20
    sprite.frustumCulled = false
    return sprite
  }

  function buildScene(teamColors) {
    scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(0x0a1826, quality.fogDensity)

    stadium = createStadium(teamColors)
    scene.add(stadium.group)
    if (quality.shadows) {
      // 観客のインスタンスは影計算から除外する（数千個の余分な描画を防ぐ）
      stadium.group.traverse((object) => {
        if (!object.isMesh) return
        const name = object.name || ''
        if (name.startsWith('crowd')) return
        const material = Array.isArray(object.material) ? object.material[0] : object.material
        if (material?.side === THREE.BackSide) return
        object.receiveShadow = true
        if (!object.isInstancedMesh && !material?.transparent) object.castShadow = true
      })
    }

    const hemisphere = new THREE.HemisphereLight(0x9fc6ff, 0x1c3324, 1.1)
    scene.add(hemisphere)

    const key = new THREE.DirectionalLight(0xfff2d0, 2)
    key.position.set(40, 70, -50)
    if (quality.shadows) {
      key.castShadow = true
      key.shadow.mapSize.set(2048, 2048)
      key.shadow.camera.left = -60
      key.shadow.camera.right = 60
      key.shadow.camera.top = 60
      key.shadow.camera.bottom = -60
      key.shadow.camera.near = 1
      key.shadow.camera.far = 220
      key.shadow.bias = -0.0004
      key.shadow.normalBias = 0.025
    }
    scene.add(key)

    const fill = new THREE.DirectionalLight(0xffd9a0, 0.6)
    fill.position.set(-35, 26, 45)
    scene.add(fill)

    camera = new THREE.PerspectiveCamera(46, 1, 0.4, 600)
    applyCameraPreset(cameraPreset, true)

    // ボール
    const ballGeometry = new THREE.SphereGeometry(BALL_RADIUS, 16, 12)
    const ballMaterial = new THREE.MeshLambertMaterial({
      color: '#fffaf0',
    })
    ball = new THREE.Mesh(ballGeometry, ballMaterial)
    const seamGeometry = new THREE.TorusGeometry(BALL_RADIUS * 0.98, 0.009, 6, 20, Math.PI * 1.25)
    const seamMaterial = new THREE.MeshLambertMaterial({ color: '#bf4032' })
    const seam = new THREE.Mesh(seamGeometry, seamMaterial)
    seam.rotation.set(Math.PI / 2, 0.4, 0)
    ball.add(seam)
    ball.scale.setScalar(1.9)
    ball.castShadow = true

    const glowTexture = createGlowTexture(quality.glowSize)
    textures.add(glowTexture)
    const glowSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    )
    glowSprite.scale.set(1.7, 1.7, 1)
    ball.add(glowSprite)

    ball.visible = false
    scene.add(ball)

    // コンタクトの光と輪（同じオブジェクトを使い回す）
    contactEffect = createContactEffect(glowTexture)
    contactEffect.group.visible = false
    scene.add(contactEffect.group)

    // 軌跡（24 点を事前確保）
    trailGeometry = new THREE.BufferGeometry()
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3))
    trailGeometry.setDrawRange(0, 0)
    const trailMaterial = new THREE.LineBasicMaterial({
      color: 0xfff5d6,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    trailLine = new THREE.Line(trailGeometry, trailMaterial)
    trailLine.visible = false
    trailLine.frustumCulled = false
    scene.add(trailLine)

    // 落下地点マーカー
    const landingGeometry = new THREE.RingGeometry(1.35, 1.8, 32)
    landingGeometry.rotateX(-Math.PI / 2)
    const landingMaterial = new THREE.MeshBasicMaterial({
      color: '#f5a524',
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    landingMarker = new THREE.Mesh(landingGeometry, landingMaterial)
    landingMarker.visible = false
    scene.add(landingMarker)

    // ストライクゾーン
    const zoneGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.6, 1.1, 0.06))
    const zoneMaterial = new THREE.LineBasicMaterial({
      color: '#f5a524',
      transparent: true,
      opacity: 0.75,
    })
    strikeZone = new THREE.LineSegments(zoneGeometry, zoneMaterial)
    setFromGame(strikeZone.position, 0, 0.25, 1)
    strikeZone.visible = false
    scene.add(strikeZone)

    // HOME RUN バナー（画面空間オーバーレイ）
    scene.add(camera)

    const banner = createTextTexture('HOME RUN', {
      font: '800 96px system-ui, sans-serif',
      color: '#f5a524',
      background: null,
      padding: 18,
      glow: 28,
      scale: quality.textScale,
    })
    textures.add(banner.texture)
    homeRunSprite = createOverlaySprite(banner.texture, banner.aspect)
    homeRunSprite.visible = false
    camera.add(homeRunSprite)

    // 投球内容のテキスト（画面空間オーバーレイ）
    const pitchText = createTextTexture('　', {
      background: 'rgba(6, 16, 26, 0.72)',
      scale: quality.textScale,
    })
    textures.add(pitchText.texture)
    pitchTextSprite = createOverlaySprite(pitchText.texture, pitchText.aspect)
    pitchTextSprite.visible = false
    camera.add(pitchTextSprite)
  }

  function applyCameraPreset(preset, force = false) {
    if (!camera) return
    setFromGame(camera.position, preset.position.x, preset.position.y, preset.position.z)
    const look = toThree(preset.target.x, preset.target.y, preset.target.z)
    camera.lookAt(look.x, look.y, look.z)
    if (force || camera.fov !== preset.fov) {
      camera.fov = preset.fov
      camera.updateProjectionMatrix()
    }
  }

  // --- キャンバス管理 ---------------------------------------------------------

  function adoptCanvas(nextCanvas) {
    if (!nextCanvas || nextCanvas === canvas) return
    canvas.className = nextCanvas.className
    for (const attribute of Array.from(nextCanvas.attributes)) {
      if (attribute.name === 'width' || attribute.name === 'height') continue
      if (canvas.getAttribute(attribute.name) === attribute.value) continue
      canvas.setAttribute(attribute.name, attribute.value)
    }
    nextCanvas.replaceWith(canvas)
  }

  function setCanvas(nextCanvas) {
    if (!nextCanvas) return
    if (renderer || nextCanvas === canvas) {
      adoptCanvas(nextCanvas)
    } else {
      canvas = nextCanvas
    }
    canvas.style.touchAction = 'none'
    resize(true)
  }

  function resize(force = false) {
    if (!renderer || !camera) return
    const width = Math.max(1, Math.round(canvas.clientWidth || FALLBACK_WIDTH))
    const height = Math.max(1, Math.round(canvas.clientHeight || FALLBACK_HEIGHT))
    if (!force && width === viewWidth && height === viewHeight) return
    viewWidth = width
    viewHeight = height
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    needsRender = true
  }

  // --- 選手リグ ---------------------------------------------------------------

  function actorSpecs(current) {
    const defenseSide = current.isTopHalf ? 'home' : 'away'
    const offenseSide = current.isTopHalf ? 'away' : 'home'
    const defenseColor = current.teams?.[defenseSide]?.color ?? DEFAULT_DEFENSE_COLOR
    const offenseColor = current.teams?.[offenseSide]?.color ?? DEFAULT_OFFENSE_COLOR
    const specs = []

    for (const [positionId, position] of Object.entries(FIELDER_POSITIONS)) {
      const behindPlate = positionId === 'C'
      specs.push({
        id: `fielder:${positionId}`,
        x: position.x,
        y: position.y,
        faceX: FIELD_POINTS.home.x,
        faceY: FIELD_POINTS.home.y,
        color: defenseColor,
        pose:
          behindPlate && ['pitch', 'bat'].includes(current.phase)
            ? 'crouch'
            : positionId === 'P' && current.phase === 'pitch'
              ? 'pitch'
              : 'field',
        scale: behindPlate ? 1 : 1.06,
      })
    }

    // 審判は捕手のさらに後ろ。打席カメラの邪魔にならないよう少し左にずらす。
    specs.push({
      id: 'umpire',
      x: -0.2,
      y: -3.7,
      faceX: FIELD_POINTS.pitcher.x,
      faceY: FIELD_POINTS.pitcher.y,
      color: '#262a32',
      pose: 'field',
      scale: 1.02,
    })

    if (!current.finished) {
      const leftHanded = battingHand(current) === 'left'
      specs.push({
        id: 'batter',
        x: leftHanded ? -BATTER_BOX_X : BATTER_BOX_X,
        y: 0.35,
        faceX: FIELD_POINTS.pitcher.x,
        faceY: FIELD_POINTS.pitcher.y,
        color: offenseColor,
        pose: 'bat',
        scale: 1.14,
      })
      // 次の打者は本塁の横で待つ
      specs.push({
        id: 'ondeck',
        x: -1.55,
        y: -1.3,
        faceX: FIELD_POINTS.pitcher.x,
        faceY: FIELD_POINTS.pitcher.y,
        color: offenseColor,
        pose: 'bat',
        scale: 0.92,
      })
    }

    BASE_POSITIONS.forEach((base, index) => {
      if (!current.runners?.[index]) return
      const face = index < BASE_POSITIONS.length - 1 ? BASE_POSITIONS[index + 1] : FIELD_POINTS.home
      specs.push({
        id: `runner:${index}`,
        x: base.x,
        y: base.y,
        faceX: face.x,
        faceY: face.y,
        color: offenseColor,
        pose: 'run',
        scale: 1.06,
      })
    })

    return { specs, defenseColor, offenseColor }
  }

  function rebuildActors(specs) {
    const keep = new Set()
    for (const spec of specs) {
      keep.add(spec.id)
      let actor = actors.get(spec.id)
      if (!actor) {
        const rig = createPlayerRig({
          jersey: spec.color,
          pose: spec.pose,
          scale: spec.scale ?? 1,
        })
        scene.add(rig.group)
        if (quality.shadows) {
          rig.group.traverse((object) => {
            if (!object.isMesh) return
            // 接地影の平たい円は影を落とさない
            object.castShadow = !object.material?.transparent
            object.receiveShadow = true
          })
        }
        actor = {
          rig,
          color: spec.color,
          pose: spec.pose,
          base: { x: spec.x, y: spec.y },
          faceX: spec.faceX,
          faceY: spec.faceY,
        }
        actors.set(spec.id, actor)
      }
      if (actor.color !== spec.color) {
        actor.rig.setJersey(spec.color)
        actor.color = spec.color
      }
      actor.base.x = spec.x
      actor.base.y = spec.y
      actor.faceX = spec.faceX
      actor.faceY = spec.faceY
      if (actor.pose !== spec.pose) {
        actor.rig.setPose(spec.pose)
        actor.pose = spec.pose
      }
      placeRig(actor.rig, spec.x, spec.y, 0)
      actor.rig.group.rotation.y = facingY(spec)
    }

    for (const [id, actor] of actors) {
      if (keep.has(id)) continue
      scene.remove(actor.rig.group)
      actor.rig.dispose()
      actors.delete(id)
    }
  }

  function syncActors(elapsed, delta, now) {
    if (!state) return

    const { specs, defenseColor, offenseColor } = actorSpecs(state)
    const hand = battingHand(state)
    const signature = [
      state.phase,
      state.isTopHalf ? 'top' : 'bottom',
      defenseColor,
      offenseColor,
      state.finished ? 'finished' : 'live',
      hand,
      (state.runners ?? []).map((runner) => (runner ? '1' : '0')).join(''),
    ].join('|')

    if (signature !== actorSignature) {
      actorSignature = signature
      rebuildActors(specs)
    }

    const homeColor = state.teams?.home?.color ?? DEFAULT_DEFENSE_COLOR
    const awayColor = state.teams?.away?.color ?? DEFAULT_OFFENSE_COLOR
    const nextStadiumKey = `${homeColor}|${awayColor}`
    if (nextStadiumKey !== stadiumKey) {
      stadiumKey = nextStadiumKey
      stadium.setTeamColors({ home: homeColor, away: awayColor })
    }

    const hitT =
      animation?.type === 'hit' ? clamp01((now - animation.startedAt) / animation.hitMs) : -1

    for (const [id, actor] of actors) {
      let pose = actor.pose
      let x = actor.base.x
      let y = actor.base.y

      if (id === 'batter') {
        // スイング → フォロースルー（よろけ） → 一塁への小さなダッシュ
        if (now >= swingAt && now < swingUntil) pose = 'swing'
        else if (now < stumbleUntil) pose = 'stumble'
        else if (hitT >= 0) pose = 'run'
        if (hitT >= 0) {
          const runT = Math.min(1, hitT / 0.6)
          x += (FIELD_POINTS.first.x - x) * RUN_OUT_FRACTION * runT
          y += (FIELD_POINTS.first.y - y) * RUN_OUT_FRACTION * runT
        }
      } else if (id.startsWith('runner:') && hitT >= 0) {
        const index = Number(id.slice('runner:'.length))
        const next =
          index < BASE_POSITIONS.length - 1 ? BASE_POSITIONS[index + 1] : FIELD_POINTS.home
        const distance = Math.hypot(next.x - x, next.y - y) || 1
        const step = Math.min(4.5, hitT * 6)
        x += ((next.x - x) / distance) * step
        y += ((next.y - y) / distance) * step
        pose = 'run'
      } else if (id.startsWith('fielder:') && id !== 'fielder:C' && hitT >= 0) {
        // 打球が出た瞬間に各野手が一歩だけ反応する
        pose = 'react'
        const target = animation.to
        const distance = Math.hypot(target.x - x, target.y - y) || 1
        const step = Math.min(1.2, hitT * 2)
        x += ((target.x - x) / distance) * step
        y += ((target.y - y) / distance) * step
      }

      if (actor.pose !== pose) {
        actor.rig.setPose(pose)
        actor.pose = pose
      }
      placeRig(actor.rig, x, y, 0)
      actor.rig.group.rotation.y = facingY({
        x: actor.base.x,
        y: actor.base.y,
        faceX: actor.faceX,
        faceY: actor.faceY,
      })
      actor.rig.update(elapsed, delta)
    }
  }

  // --- ボールアニメーション ---------------------------------------------------

  function startAnimation() {
    if (!state?.lastPitch) return
    trailSamples.length = 0
    needsRender = true
    const lastPitch = state.lastPitch
    const isInPlay = lastPitch.kind === 'inplay'
    const target = isInPlay ? hitTargetFor(lastPitch.location) : null
    // flightMs はオンライン/将来の拡張で渡されることがあるので防御的に読む
    const flightMs =
      Number.isFinite(lastPitch.flightMs) && lastPitch.flightMs > 0
        ? lastPitch.flightMs
        : PITCH_FLIGHT_MS
    const didSwing = isInPlay || Number.isFinite(lastPitch.timingQuality)
    const now = performance.now()

    swingAt = didSwing ? now + Math.max(0, flightMs - SWING_MS * 0.55) : Infinity
    swingUntil = didSwing ? swingAt + SWING_MS : 0
    stumbleUntil = target ? swingUntil + FOLLOW_THROUGH_MS : 0
    punchUntil = 0
    animation = {
      type: 'pitch',
      startedAt: now,
      flightMs,
      courseId: lastPitch.courseId,
      hitTarget: target,
      hitHeight: isInPlay ? hitArcHeight(lastPitch.outcome) : 0,
      hitMs: HIT_FLIGHT_MS,
    }
  }

  function advanceAnimation(now) {
    if (!animation) return null
    const elapsed = now - animation.startedAt

    if (animation.type === 'pitch') {
      const t = clamp01(elapsed / animation.flightMs)
      const point = pitchPoint(animation.courseId, t)
      if (t >= 1) {
        if (animation.hitTarget) {
          const from = hitStart()
          animation = {
            type: 'hit',
            startedAt: now,
            from,
            to: animation.hitTarget,
            height: animation.hitHeight,
            hitMs: animation.hitMs,
          }
          // バットが当たった瞬間の光・輪と画角パンチ
          contactEffect?.trigger(from.x, from.y, from.z, now)
          landingAt = now
          punchUntil = now + CONTACT_PUNCH_MS
        } else {
          animation = null
        }
      }
      return point
    }

    const t = clamp01(elapsed / animation.hitMs)
    const point = hitPoint(animation.from, animation.to, animation.height, t)
    if (t >= 1) animation = null
    return point
  }

  function updateBall(point, now) {
    if (!ball) return
    if (!point) {
      ball.visible = false
      trailLine.visible = false
      trailSamples.length = 0
      if (landingMarker) landingMarker.visible = false
      return
    }

    ball.visible = true
    setFromGame(ball.position, point.x, point.y, point.z)

    trailSamples.push({ x: point.x, y: point.y, z: point.z, at: now })
    while (trailSamples.length > TRAIL_MAX) trailSamples.shift()
    while (trailSamples.length > 0 && now - trailSamples[0].at >= TRAIL_WINDOW_MS) {
      trailSamples.shift()
    }

    for (let index = 0; index < trailSamples.length; index += 1) {
      const sample = trailSamples[index]
      trailPositions[index * 3] = sample.x
      trailPositions[index * 3 + 1] = sample.z
      trailPositions[index * 3 + 2] = -sample.y
    }
    trailGeometry.attributes.position.needsUpdate = true
    trailGeometry.setDrawRange(0, trailSamples.length)
    trailLine.visible = trailSamples.length > 1

    if (landingMarker) {
      const showing = animation?.type === 'hit' && animation.to
      landingMarker.visible = Boolean(showing)
      if (showing) {
        setFromGame(landingMarker.position, animation.to.x, animation.to.y, 0.05)
        const t = clamp01((now - landingAt) / animation.hitMs)
        landingMarker.scale.setScalar(0.65 + 0.45 * Math.sin(Math.PI * t))
        landingMarker.material.opacity = 0.35 + 0.45 * t
      }
    }
  }

  // --- テキスト・演出 ---------------------------------------------------------

  const OVERLAY_DISTANCE = 2

  /**
   * 画面空間スプライトをカメラ前方に置き、画面に対する比率で大きさを決める。
   * sizeAttenuation: false のとき、スプライトの NDC 高さは scale.y / tan(fov/2)。
   */
  function layoutOverlay(sprite, { heightRatio, maxWidthRatio, ndcY }) {
    if (!sprite || !camera) return
    const textureAspect = sprite.userData.aspect || 1
    const screenAspect =
      Math.max(0.2, (viewWidth || FALLBACK_WIDTH) / (viewHeight || FALLBACK_HEIGHT)) || 1.78
    const tanHalfFov = Math.max(0.05, Math.tan((camera.fov * Math.PI) / 360))
    let height = heightRatio * 2 * tanHalfFov
    let width = height * textureAspect
    const maxWidth = maxWidthRatio * 2 * tanHalfFov * screenAspect
    if (width > maxWidth) {
      width = maxWidth
      height = width / textureAspect
    }
    sprite.scale.set(width, height, 1)
    sprite.position.set(0, ndcY * OVERLAY_DISTANCE * tanHalfFov, -OVERLAY_DISTANCE)
  }

  function updatePitchText() {
    if (!pitchTextSprite) return
    const text = state?.lastPitch?.text ?? ''
    const visible = Boolean(text) && ['pitch', 'bat'].includes(state?.phase)
    pitchTextSprite.visible = visible
    if (!visible) return

    if (text !== pitchTextValue) {
      pitchTextValue = text
      const { texture, aspect } = createTextTexture(text, {
        background: 'rgba(6, 16, 26, 0.72)',
        scale: quality.textScale,
      })
      textures.add(texture)
      const previous = pitchTextSprite.material.map
      pitchTextSprite.material.map = texture
      pitchTextSprite.material.needsUpdate = true
      pitchTextSprite.userData.aspect = aspect
      if (previous) {
        textures.delete(previous)
        previous.dispose()
      }
    }
    layoutOverlay(pitchTextSprite, { heightRatio: 0.09, maxWidthRatio: 0.42, ndcY: 0.66 })
  }

  function updateEffects(now) {
    contactEffect?.update(now)
    if (homeRunSprite) {
      const showing = Boolean(state?.lastPitch?.outcome === 'homerun' && animation?.type === 'hit')
      homeRunSprite.visible = showing
      if (showing) {
        layoutOverlay(homeRunSprite, { heightRatio: 0.17, maxWidthRatio: 0.66, ndcY: 0.4 })
      }
    }
    if (strikeZone) {
      strikeZone.visible = Boolean(state && ['pitch', 'bat'].includes(state.phase))
    }
    updatePitchText()
  }

  // --- 適応解像度 -------------------------------------------------------------

  function applyPixelRatio(now, reason) {
    renderer.setPixelRatio(pixelRatio)
    canvas.dataset.pixelRatio = String(pixelRatio)
    canvas.dataset.adaptiveReason = reason
    renderSamples.length = 0
    lastAdjustAt = now
    resize(true)
  }

  /** 描画が重いときだけ DPR を下げ、十分に速いときだけ元に戻す */
  function adaptResolution(now, renderMs) {
    if (quality.mode !== 'high' || !renderer) return
    renderSamples.push(renderMs)
    if (renderSamples.length > ADAPT_UP_FRAMES) renderSamples.shift()
    if (now - lastAdjustAt < ADAPT_COOLDOWN_MS) return

    const average = (count) => {
      const start = renderSamples.length - count
      let sum = 0
      for (let index = start; index < renderSamples.length; index += 1) sum += renderSamples[index]
      return sum / count
    }

    if (renderSamples.length >= ADAPT_DOWN_FRAMES) {
      if (average(ADAPT_DOWN_FRAMES) > ADAPT_DOWN_MS && pixelRatio > ADAPT_FLOOR + 0.001) {
        pixelRatio = Math.max(ADAPT_FLOOR, Math.round((pixelRatio - ADAPT_STEP) * 100) / 100)
        applyPixelRatio(now, 'down')
        return
      }
    }
    if (renderSamples.length >= ADAPT_UP_FRAMES) {
      if (average(ADAPT_UP_FRAMES) < ADAPT_UP_MS && pixelRatio < quality.pixelRatio - 0.001) {
        pixelRatio = Math.min(quality.pixelRatio, Math.round((pixelRatio + ADAPT_STEP) * 100) / 100)
        applyPixelRatio(now, 'up')
      }
    }
  }

  // --- 描画ループ -------------------------------------------------------------

  function draw(now) {
    if (!running) return

    if (!renderer) {
      drawFallback()
      lastFrameTime = now
      frame = requestAnimationFrame(draw)
      return
    }

    resize()

    const elapsed = now / 1000
    const delta = lastFrameTime > 0 ? Math.min(0.1, (now - lastFrameTime) / 1000) : 0

    let active = Boolean(animation) || now < swingUntil || now < stumbleUntil || now < punchUntil
    const wasAnimating = Boolean(animation)
    const ballPoint = advanceAnimation(now)
    if (wasAnimating && !animation) needsRender = true
    active = active || Boolean(animation)

    if (state) {
      syncActors(elapsed, delta, now)

      let targetPreset = viewPresetForPhase(state.phase)
      if (animation?.type === 'hit' && ballPoint) targetPreset = dramaticHitPreset(ballPoint)
      // コンタクトの直後に画角を少し広げてパンチを出す
      if (now < punchUntil) {
        targetPreset = punchPreset(targetPreset, 5.5 * ((punchUntil - now) / CONTACT_PUNCH_MS))
      }
      cameraPreset = stepCamera(cameraPreset, targetPreset, 0.1)
      active = active || !cameraSettled(cameraPreset, targetPreset)
      applyCameraPreset(cameraPreset)
    } else {
      applyCameraPreset(cameraPreset)
    }

    // 変化がないフレームは描画を省略して、CPU とバッテリーを節約する
    if (!active && !needsRender) {
      lastFrameTime = now
      frame = requestAnimationFrame(draw)
      return
    }
    if (active && now - lastRenderAt < quality.maxFrameMs) {
      lastFrameTime = now
      frame = requestAnimationFrame(draw)
      return
    }

    stadium.update(elapsed)
    updateBall(ballPoint, now)
    updateEffects(now)

    const renderStartedAt = performance.now()
    renderer.render(scene, camera)
    lastRenderMs = performance.now() - renderStartedAt
    canvas.dataset.renderMs = lastRenderMs.toFixed(1)
    adaptResolution(now, lastRenderMs)
    lastRenderAt = now
    needsRender = false
    lastFrameTime = now
    frame = requestAnimationFrame(draw)
  }

  // --- 公開 API ---------------------------------------------------------------

  function setState(nextState) {
    const previousLogLength = lastLogLength
    state = nextState
    lastLogLength = nextState?.log?.length ?? null
    needsRender = true

    if (previousLogLength === null) {
      cameraPreset = copyPreset(viewPresetForPhase(nextState?.phase ?? 'field'))
      needsRender = true
      return
    }
    if (lastLogLength > previousLogLength) startAnimation()
  }

  function start() {
    if (running) return
    running = true
    canvas.style.touchAction = 'none'
    frame = requestAnimationFrame(draw)
  }

  function stop() {
    running = false
    cancelAnimationFrame(frame)
  }

  function destroy() {
    stop()
    if (destroyed) return
    destroyed = true

    for (const actor of actors.values()) {
      if (scene) scene.remove(actor.rig.group)
      actor.rig.dispose()
    }
    actors.clear()

    if (stadium) {
      stadium.dispose()
      if (scene) scene.remove(stadium.group)
      stadium = null
    }

    if (contactEffect) {
      contactEffect.dispose()
      if (scene) scene.remove(contactEffect.group)
      contactEffect = null
    }

    if (scene) {
      scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose()
        const list = Array.isArray(object.material) ? object.material : [object.material]
        for (const material of list) if (material) material.dispose()
      })
      scene.clear()
    }

    for (const material of spriteMaterials) material.dispose()
    spriteMaterials.clear()
    for (const texture of textures) texture.dispose()
    textures.clear()

    if (renderer) {
      renderer.dispose()
      renderer = null
    }

    scene = null
    camera = null
    ball = null
    trailLine = null
    trailGeometry = null
    landingMarker = null
    contactEffect = null
    strikeZone = null
    homeRunSprite = null
    pitchTextSprite = null
    context2d = null
    state = null
    animation = null
    swingAt = Infinity
    swingUntil = 0
    stumbleUntil = 0
    punchUntil = 0
    trailSamples.length = 0
    actorSignature = ''
    lastLogLength = null
  }

  // --- 初期化 -----------------------------------------------------------------

  const teamColors = { homeColor: DEFAULT_DEFENSE_COLOR, awayColor: DEFAULT_OFFENSE_COLOR }
  canvas.dataset.quality = quality.mode
  canvas.dataset.pixelRatio = String(pixelRatio)

  if (createRenderer()) {
    buildScene(teamColors)
    resize(true)
  } else {
    setupFallback()
    drawFallback()
  }

  canvas.style.touchAction = 'none'

  return {
    setCanvas,
    setState,
    start,
    stop,
    destroy,
    get lastFrameTime() {
      return lastFrameTime
    },
  }
}
