/**
 * three.js による試合ビュー。
 *
 * 旧 Canvas 2D レンダラーと同じ公開 API・アニメーション挙動を保ちつつ、
 * 球場・選手リグ・ボールを実 3D で描画する。
 * main.js は操作のたびに画面 HTML を作り直すため、WebGL の canvas は
 * setCanvas() で使い回し、GPU リソースの再構築を避ける。
 */

import * as THREE from '../../../vendor/three/three.module.js'
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
import { cameraSettled, hitFollowPreset, presetForPhase, stepCamera } from './cameraRig.js'

const FALLBACK_WIDTH = 640
const FALLBACK_HEIGHT = 360
const TRAIL_MAX = 24
const TRAIL_WINDOW_MS = 260
const SWING_MS = 380
const MIN_FRAME_MS = 1000 / 24
const DEFAULT_DEFENSE_COLOR = '#4a90d9'
const DEFAULT_OFFENSE_COLOR = '#f5a524'

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
  } = options

  const measureCanvas = document.createElement('canvas')
  const measure = measureCanvas.getContext('2d')
  measure.font = font
  const fontSize = Number((font.match(/(\d+(?:\.\d+)?)px/) || [])[1] || 48)
  const baseHeight = Math.ceil(fontSize * 1.2)
  const width = Math.max(32, Math.ceil(measure.measureText(text).width + padding * 2))
  const height = Math.ceil(baseHeight + padding * 2)

  const textureCanvas = document.createElement('canvas')
  textureCanvas.width = width
  textureCanvas.height = height
  const context = textureCanvas.getContext('2d')

  if (background) {
    context.fillStyle = background
    context.beginPath()
    context.roundRect(0, 0, width, height, 14)
    context.fill()
  }

  context.font = font
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillStyle = color
  if (glow > 0) {
    context.shadowColor = color
    context.shadowBlur = glow
  }
  context.fillText(text, width / 2, height / 2)

  const texture = new THREE.CanvasTexture(textureCanvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return { texture, aspect: width / height }
}

/** ボールを遠くからでも見失わないための発光テクスチャ */
function createGlowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d')
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64)
  gradient.addColorStop(0, 'rgba(255, 252, 235, 0.95)')
  gradient.addColorStop(0.45, 'rgba(255, 246, 214, 0.45)')
  gradient.addColorStop(1, 'rgba(255, 246, 214, 0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 128, 128)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** リグの向き（three.js の +z が正面）をゲーム座標の目標点から求める */
function facingY({ x, y, faceX, faceY }) {
  const dx = faceX - x
  const dy = faceY - y
  if (dx === 0 && dy === 0) return 0
  return Math.atan2(dx, -dy)
}

export function createMatchView(initialCanvas) {
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
  let swingUntil = 0
  let viewWidth = 0
  let viewHeight = 0
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
        antialias: false,
        powerPreference: 'high-performance',
      })
      renderer.setPixelRatio(0.8)
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.05
      renderer.shadowMap.enabled = false
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
    scene.fog = new THREE.FogExp2(0x0a1826, 0.0016)

    stadium = createStadium(teamColors)
    scene.add(stadium.group)

    const hemisphere = new THREE.HemisphereLight(0x9fc6ff, 0x1c3324, 1.1)
    scene.add(hemisphere)

    const key = new THREE.DirectionalLight(0xfff2d0, 2)
    key.position.set(40, 70, -50)
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

    const glowTexture = createGlowTexture()
    textures.add(glowTexture)
    const glowSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    )
    glowSprite.scale.set(1.3, 1.3, 1)
    ball.add(glowSprite)

    ball.visible = false
    scene.add(ball)

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
    })
    textures.add(banner.texture)
    homeRunSprite = createOverlaySprite(banner.texture, banner.aspect)
    homeRunSprite.visible = false
    camera.add(homeRunSprite)

    // 投球内容のテキスト（画面空間オーバーレイ）
    const pitchText = createTextTexture('　', { background: 'rgba(6, 16, 26, 0.72)' })
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
      specs.push({
        id: `fielder:${positionId}`,
        x: position.x,
        y: position.y,
        faceX: FIELD_POINTS.home.x,
        faceY: FIELD_POINTS.home.y,
        color: defenseColor,
        pose: positionId === 'P' && current.phase === 'pitch' ? 'pitch' : 'field',
      })
    }

    if (!current.finished) {
      specs.push({
        id: 'batter',
        x: 0,
        y: 0.15,
        faceX: FIELD_POINTS.pitcher.x,
        faceY: FIELD_POINTS.pitcher.y,
        color: offenseColor,
        pose: 'bat',
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
        const rig = createPlayerRig({ jersey: spec.color, pose: spec.pose })
        scene.add(rig.group)
        actor = { rig, color: spec.color, pose: spec.pose }
        actors.set(spec.id, actor)
      }
      if (actor.color !== spec.color) {
        actor.rig.setJersey(spec.color)
        actor.color = spec.color
      }
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

  function syncActors(elapsed, delta) {
    if (!state) return

    const { specs, defenseColor, offenseColor } = actorSpecs(state)
    const signature = [
      state.phase,
      state.isTopHalf ? 'top' : 'bottom',
      defenseColor,
      offenseColor,
      state.finished ? 'finished' : 'live',
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

    const batter = actors.get('batter')
    if (batter) {
      const batterPose = performance.now() < swingUntil ? 'swing' : 'bat'
      if (batter.pose !== batterPose) {
        batter.rig.setPose(batterPose)
        batter.pose = batterPose
      }
    }

    for (const actor of actors.values()) actor.rig.update(elapsed, delta)
  }

  // --- ボールアニメーション ---------------------------------------------------

  function startAnimation() {
    if (!state?.lastPitch) return
    trailSamples.length = 0
    needsRender = true
    const isInPlay = state.lastPitch.kind === 'inplay'
    const target = isInPlay ? hitTargetFor(state.lastPitch.location) : null
    animation = {
      type: 'pitch',
      startedAt: performance.now(),
      courseId: state.lastPitch.courseId,
      hitTarget: target,
      hitHeight: isInPlay ? hitArcHeight(state.lastPitch.outcome) : 0,
    }
    if (target) swingUntil = performance.now() + SWING_MS
  }

  function advanceAnimation(now) {
    if (!animation) return null
    const elapsed = now - animation.startedAt

    if (animation.type === 'pitch') {
      const t = clamp01(elapsed / PITCH_FLIGHT_MS)
      const point = pitchPoint(animation.courseId, t)
      if (t >= 1) {
        if (animation.hitTarget) {
          animation = {
            type: 'hit',
            startedAt: now,
            from: hitStart(),
            to: animation.hitTarget,
            height: animation.hitHeight,
          }
        } else {
          animation = null
        }
      }
      return point
    }

    const t = clamp01(elapsed / HIT_FLIGHT_MS)
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
      const { texture, aspect } = createTextTexture(text, { background: 'rgba(6, 16, 26, 0.72)' })
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

  function updateEffects() {
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

    let active = Boolean(animation) || now < swingUntil
    const wasAnimating = Boolean(animation)
    const ballPoint = advanceAnimation(now)
    if (wasAnimating && !animation) needsRender = true
    active = active || Boolean(animation)

    if (state) {
      syncActors(elapsed, delta)

      let targetPreset = presetForPhase(state.phase)
      if (animation?.type === 'hit' && ballPoint) targetPreset = hitFollowPreset(ballPoint)
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
    if (active && now - lastRenderAt < MIN_FRAME_MS) {
      lastFrameTime = now
      frame = requestAnimationFrame(draw)
      return
    }

    stadium.update(elapsed)
    updateBall(ballPoint, now)
    updateEffects()

    renderer.render(scene, camera)
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
      cameraPreset = copyPreset(presetForPhase(nextState?.phase ?? 'field'))
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
    strikeZone = null
    homeRunSprite = null
    pitchTextSprite = null
    context2d = null
    state = null
    animation = null
    trailSamples.length = 0
    actorSignature = ''
    lastLogLength = null
  }

  // --- 初期化 -----------------------------------------------------------------

  const teamColors = { homeColor: DEFAULT_DEFENSE_COLOR, awayColor: DEFAULT_OFFENSE_COLOR }

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
