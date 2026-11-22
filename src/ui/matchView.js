import { CAMERA_PRESETS, createCamera, lerpCamera, projectPoint } from '../game/camera.js'
import {
  BASE_POSITIONS,
  BATTED_BALL_TARGETS,
  FIELD_POINTS,
  FIELDER_POSITIONS,
  FOUL_POLES,
  fencePoints,
} from '../game/field.js'

/**
 * 疑似3Dの試合ビュー。
 *
 * Canvas 2D に透視投影したフィールド・選手・ボールを描く。
 * 試合ロジックには触れず、state を読んで表示するだけ。
 */

const FIELD_GREEN = '#1f6b45'
const FIELD_DARK = '#164f34'
const DIRT = '#7a5638'
const DIRT_LIGHT = '#936a45'
const LINE = 'rgba(235, 244, 255, 0.62)'

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function easeOutCubic(value) {
  return 1 - (1 - value) ** 3
}

function mixPoint(from, to, t) {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    z: from.z + (to.z - from.z) * t,
  }
}

function courseTarget(courseId) {
  const parts = String(courseId ?? 'middle-center').split('-')
  const row = parts[0]
  const column = parts[1]
  return {
    x: column === 'in' ? -0.38 : column === 'out' ? 0.38 : 0,
    y: 0.2,
    z: row === 'high' ? 1.46 : row === 'low' ? 0.58 : 1.02,
  }
}

export function createMatchView(initialCanvas) {
  let canvas = initialCanvas
  let context = canvas.getContext('2d')
  let state = null
  let running = false
  let frame = 0
  let lastLogLength = null
  let animation = null
  let trail = []
  let viewport = { width: 640, height: 360 }
  let cameraPreset = CAMERA_PRESETS.field
  let lastFrameTime = 0

  function resize() {
    const rect = canvas.getBoundingClientRect()
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const width = Math.max(1, Math.round(rect.width * dpr))
    const height = Math.max(1, Math.round(rect.height * dpr))

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }

    viewport = { width: rect.width, height: rect.height }
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  function camera() {
    return createCamera(cameraPreset)
  }

  function project(point, currentCamera) {
    return projectPoint(currentCamera, point, viewport)
  }

  function fillPolygon(points, color, currentCamera, alpha = 1) {
    const projected = points.map((point) => project(point, currentCamera))
    if (projected.some((point) => !point)) return

    context.save()
    context.globalAlpha = alpha
    context.beginPath()
    context.moveTo(projected[0].x, projected[0].y)
    for (const point of projected.slice(1)) context.lineTo(point.x, point.y)
    context.closePath()
    context.fillStyle = color
    context.fill()
    context.restore()
  }

  function drawLine(from, to, color, width, currentCamera) {
    const a = project(from, currentCamera)
    const b = project(to, currentCamera)
    if (!a || !b) return

    context.save()
    context.strokeStyle = color
    context.lineWidth = width
    context.beginPath()
    context.moveTo(a.x, a.y)
    context.lineTo(b.x, b.y)
    context.stroke()
    context.restore()
  }

  function drawText(text, point, color, currentCamera, size = 11) {
    const projected = project(point, currentCamera)
    if (!projected) return

    context.save()
    context.fillStyle = color
    context.font = `700 ${size}px system-ui, sans-serif`
    context.textAlign = 'center'
    context.fillText(text, projected.x, projected.y)
    context.restore()
  }

  function drawBackdrop() {
    const width = viewport.width
    const height = viewport.height
    const horizon = height * 0.34

    const sky = context.createLinearGradient(0, 0, 0, horizon + 30)
    sky.addColorStop(0, '#020812')
    sky.addColorStop(0.55, '#0b1b2c')
    sky.addColorStop(1, '#17394a')
    context.fillStyle = sky
    context.fillRect(0, 0, width, horizon + 30)

    // 遠くのスタンド
    context.fillStyle = '#07131d'
    context.fillRect(0, horizon - 22, width, 54)
    context.fillStyle = 'rgba(120, 158, 180, 0.28)'
    for (let row = 0; row < 5; row += 1) {
      for (let x = 8 + (row % 2) * 7; x < width; x += 13) {
        context.fillRect(x, horizon - 18 + row * 8, 3, 2)
      }
    }

    // スタジアムライト
    const lights = [width * 0.11, width * 0.89]
    for (const x of lights) {
      context.strokeStyle = '#33536a'
      context.lineWidth = 2
      context.beginPath()
      context.moveTo(x, horizon - 10)
      context.lineTo(x, height * 0.07)
      context.stroke()

      context.fillStyle = 'rgba(255, 246, 210, 0.9)'
      context.shadowColor = '#fff3c4'
      context.shadowBlur = 16
      for (const offset of [-7, 0, 7]) {
        context.beginPath()
        context.arc(x + offset, height * 0.07, 2.4, 0, Math.PI * 2)
        context.fill()
      }
      context.shadowBlur = 0
    }

    // 遠景のビル群
    context.fillStyle = '#0a1924'
    for (let index = 0; index < 16; index += 1) {
      const buildingX = (index / 16) * width
      const buildingWidth = width / 16 + 2
      const buildingHeight = 8 + ((index * 13) % 24)
      context.fillRect(buildingX, horizon - 22 - buildingHeight, buildingWidth, buildingHeight)
    }

    // ファウルグラウンド
    const ground = context.createLinearGradient(0, horizon, 0, height)
    ground.addColorStop(0, '#173a2b')
    ground.addColorStop(1, '#0a1c16')
    context.fillStyle = ground
    context.fillRect(0, horizon, width, height - horizon)
  }

  function drawVignette() {
    const width = viewport.width
    const height = viewport.height
    const vignette = context.createRadialGradient(
      width / 2,
      height * 0.52,
      Math.min(width, height) * 0.24,
      width / 2,
      height * 0.52,
      Math.max(width, height) * 0.78,
    )
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)')
    vignette.addColorStop(1, 'rgba(0, 4, 10, 0.62)')
    context.fillStyle = vignette
    context.fillRect(0, 0, width, height)
  }

  function drawArc(radius, color, width, currentCamera) {
    const points = fencePoints(24, radius)
    for (let index = 0; index < points.length - 1; index += 1) {
      drawLine(points[index], points[index + 1], color, width, currentCamera)
    }
  }

  function drawOutfield(currentCamera) {
    const fence = fencePoints(22)
    const warningInner = fencePoints(22, 94)

    fillPolygon([{ x: 0, y: 0, z: 0 }, ...fence], FIELD_GREEN, currentCamera)
    fillPolygon([...warningInner, ...[...fence].reverse()], '#8a7358', currentCamera, 0.9)
    fillPolygon(
      [
        { x: 0, y: 0, z: 0 },
        { x: -48, y: 82, z: 0 },
        { x: 0, y: 92, z: 0 },
        { x: 48, y: 82, z: 0 },
      ],
      FIELD_DARK,
      currentCamera,
      0.3,
    )

    // 芝の刈り込み模様
    for (const radius of [48, 58, 68, 78, 88]) {
      drawArc(radius, 'rgba(214, 255, 220, 0.08)', 7, currentCamera)
    }

    // 外野フェンス（奥行きのある壁）
    for (let index = 0; index < fence.length - 1; index += 1) {
      const groundA = fence[index]
      const groundB = fence[index + 1]
      const topA = { x: groundA.x, y: groundA.y, z: 3.4 }
      const topB = { x: groundB.x, y: groundB.y, z: 3.4 }
      fillPolygon([groundA, groundB, topB, topA], '#17313c', currentCamera, 0.96)
      drawLine(topA, topB, '#e6d36a', 2, currentCamera)
    }

    drawLine({ x: 0, y: 0, z: 0 }, FOUL_POLES.left, LINE, 2, currentCamera)
    drawLine({ x: 0, y: 0, z: 0 }, FOUL_POLES.right, LINE, 2, currentCamera)

    // ファウルポール
    for (const pole of [FOUL_POLES.left, FOUL_POLES.right]) {
      drawLine({ ...pole, z: 0 }, { ...pole, z: 12 }, 'rgba(245, 214, 90, 0.92)', 3, currentCamera)
    }
  }

  function drawInfield(currentCamera) {
    fillPolygon(
      [FIELD_POINTS.home, FIELD_POINTS.first, FIELD_POINTS.second, FIELD_POINTS.third],
      DIRT,
      currentCamera,
    )

    // マウンド
    const mound = []
    for (let index = 0; index < 18; index += 1) {
      const angle = (Math.PI * 2 * index) / 18
      mound.push({
        x: Math.cos(angle) * 2.7,
        y: FIELD_POINTS.pitcher.y + Math.sin(angle) * 2.7,
        z: 0,
      })
    }
    fillPolygon(mound, DIRT_LIGHT, currentCamera)

    const bases = [FIELD_POINTS.first, FIELD_POINTS.second, FIELD_POINTS.third]
    for (const base of bases) {
      const center = project(base, currentCamera)
      if (!center) continue
      const size = clamp(center.scale * 1.2, 3, 12)
      context.save()
      context.translate(center.x, center.y)
      context.rotate(Math.PI / 4)
      context.fillStyle = '#f4f1e6'
      context.fillRect(-size / 2, -size / 2, size, size)
      context.strokeStyle = 'rgba(255,255,255,0.6)'
      context.lineWidth = 1
      context.strokeRect(-size / 2, -size / 2, size, size)
      context.restore()
    }

    const home = project(FIELD_POINTS.home, currentCamera)
    if (home) {
      const size = clamp(home.scale * 0.7, 3, 9)
      context.save()
      context.fillStyle = '#f4f1e6'
      context.beginPath()
      context.moveTo(home.x, home.y - size)
      context.lineTo(home.x + size, home.y)
      context.lineTo(home.x, home.y + size)
      context.lineTo(home.x - size, home.y)
      context.closePath()
      context.fill()
      context.restore()
    }
  }

  function drawStrikeZone(currentCamera) {
    if (!state || !['pitch', 'bat'].includes(state.phase)) return

    const corners = [
      { x: -0.3, y: 0.25, z: 0.45 },
      { x: 0.3, y: 0.25, z: 0.45 },
      { x: 0.3, y: 0.25, z: 1.55 },
      { x: -0.3, y: 0.25, z: 1.55 },
    ].map((point) => project(point, currentCamera))
    if (corners.some((point) => !point)) return

    context.save()
    context.strokeStyle = 'rgba(245, 165, 36, 0.75)'
    context.lineWidth = 1.5
    context.beginPath()
    context.moveTo(corners[0].x, corners[0].y)
    for (const point of corners.slice(1)) context.lineTo(point.x, point.y)
    context.closePath()
    context.stroke()
    context.fillStyle = 'rgba(245, 165, 36, 0.06)'
    context.fill()
    context.restore()
  }

  function drawPerson(position, options, currentCamera, highlight = false) {
    const { jersey, label, pose = 'field' } = options
    const ground = project({ ...position, z: 0 }, currentCamera)
    const head = project({ ...position, z: 1.8 }, currentCamera)
    if (!ground || !head) return

    const height = Math.max(10, ground.y - head.y)
    const bodyWidth = Math.max(3, height * 0.19)
    const headRadius = Math.max(2.5, height * 0.16)
    const hip = { x: ground.x, y: ground.y - height * 0.4 }
    const shoulder = { x: ground.x, y: ground.y - height * 0.76 }

    context.save()
    context.lineCap = 'round'
    context.lineJoin = 'round'

    // 影
    context.fillStyle = 'rgba(0, 0, 0, 0.34)'
    context.beginPath()
    context.ellipse(ground.x, ground.y, bodyWidth * 1.7, bodyWidth * 0.6, 0, 0, Math.PI * 2)
    context.fill()

    if (highlight) {
      context.strokeStyle = 'rgba(245, 165, 36, 0.9)'
      context.lineWidth = 2
      context.beginPath()
      context.ellipse(ground.x, ground.y, bodyWidth * 2.3, bodyWidth * 0.9, 0, 0, Math.PI * 2)
      context.stroke()
    }

    // 脚
    context.strokeStyle = '#e9edf2'
    context.lineWidth = Math.max(1.5, bodyWidth * 0.42)
    context.beginPath()
    context.moveTo(hip.x, hip.y)
    context.lineTo(ground.x - bodyWidth * 0.5, ground.y)
    context.moveTo(hip.x, hip.y)
    context.lineTo(ground.x + bodyWidth * 0.5, ground.y)
    context.stroke()

    // 胴体
    context.strokeStyle = jersey
    context.lineWidth = bodyWidth * 1.05
    context.beginPath()
    context.moveTo(hip.x, hip.y)
    context.lineTo(shoulder.x, shoulder.y)
    context.stroke()

    // 腕
    context.strokeStyle = jersey
    context.lineWidth = Math.max(1.4, bodyWidth * 0.34)
    context.beginPath()
    if (pose === 'pitch') {
      context.moveTo(shoulder.x, shoulder.y)
      context.lineTo(shoulder.x + height * 0.2, shoulder.y - height * 0.18)
      context.moveTo(shoulder.x, shoulder.y)
      context.lineTo(shoulder.x - height * 0.1, shoulder.y + height * 0.18)
    } else if (pose === 'bat') {
      context.moveTo(shoulder.x, shoulder.y)
      context.lineTo(shoulder.x + height * 0.2, shoulder.y + height * 0.16)
      context.moveTo(shoulder.x, shoulder.y)
      context.lineTo(shoulder.x + height * 0.26, shoulder.y + height * 0.08)
    } else if (pose === 'run') {
      context.moveTo(shoulder.x, shoulder.y)
      context.lineTo(shoulder.x + height * 0.18, shoulder.y + height * 0.12)
      context.moveTo(shoulder.x, shoulder.y)
      context.lineTo(shoulder.x - height * 0.12, shoulder.y + height * 0.18)
    } else {
      context.moveTo(shoulder.x, shoulder.y)
      context.lineTo(shoulder.x - height * 0.17, shoulder.y + height * 0.23)
      context.moveTo(shoulder.x, shoulder.y)
      context.lineTo(shoulder.x + height * 0.17, shoulder.y + height * 0.23)
    }
    context.stroke()

    // バット
    if (pose === 'bat') {
      context.strokeStyle = '#d7b36a'
      context.lineWidth = Math.max(1.2, bodyWidth * 0.22)
      context.beginPath()
      context.moveTo(shoulder.x + height * 0.18, shoulder.y + height * 0.14)
      context.lineTo(shoulder.x + height * 0.52, shoulder.y - height * 0.18)
      context.stroke()
    }

    // 頭・帽子
    context.fillStyle = '#e1b38c'
    context.beginPath()
    context.arc(head.x, head.y, headRadius, 0, Math.PI * 2)
    context.fill()
    context.strokeStyle = jersey
    context.lineWidth = Math.max(1.2, headRadius * 0.5)
    context.beginPath()
    context.arc(head.x, head.y - headRadius * 0.35, headRadius, Math.PI, Math.PI * 2)
    context.stroke()

    // 守備位置ラベル
    const fontSize = clamp(height * 0.16, 8, 12)
    context.font = `700 ${fontSize}px system-ui, sans-serif`
    context.textAlign = 'center'
    const labelY = ground.y + fontSize + 3
    const labelWidth = Math.max(12, context.measureText(label).width + 8)
    context.fillStyle = 'rgba(5, 14, 22, 0.72)'
    context.beginPath()
    context.roundRect(ground.x - labelWidth / 2, labelY - fontSize, labelWidth, fontSize + 4, 3)
    context.fill()
    context.fillStyle = 'rgba(235, 246, 255, 0.9)'
    context.fillText(label, ground.x, labelY)
    context.restore()
  }

  function drawPlayers(currentCamera) {
    if (!state) return

    const defenseSide = state.isTopHalf ? 'home' : 'away'
    const offenseSide = state.isTopHalf ? 'away' : 'home'
    const defenseTeam = state.teams[defenseSide]
    const offenseTeam = state.teams[offenseSide]
    const defenseColor = defenseTeam.color ?? '#4a90d9'
    const offenseColor = offenseTeam.color ?? '#f5a524'
    const highlightPitcher = state.phase === 'pitch' ? 'P' : null
    const highlightBatter = state.phase === 'bat'

    for (const [positionId, position] of Object.entries(FIELDER_POSITIONS)) {
      drawPerson(
        position,
        {
          jersey: defenseColor,
          label: positionId,
          pose: positionId === 'P' && state.phase === 'pitch' ? 'pitch' : 'field',
        },
        currentCamera,
        positionId === highlightPitcher,
      )
    }

    // 打者（ホームベース付近）
    if (!state.finished) {
      drawPerson(
        { x: 0, y: 0.1 },
        { jersey: offenseColor, label: '打', pose: 'bat' },
        currentCamera,
        highlightBatter,
      )
    }

    // 走者
    BASE_POSITIONS.forEach((base, index) => {
      if (!state.runners[index]) return
      drawPerson(base, { jersey: offenseColor, label: '走', pose: 'run' }, currentCamera)
    })
  }

  function animationPoint(now) {
    if (!animation) return null

    const elapsed = now - animation.startedAt

    if (animation.type === 'pitch') {
      const t = clamp(elapsed / animation.duration, 0, 1)
      const point = mixPoint(
        { x: 0, y: FIELD_POINTS.pitcher.y, z: 1.82 },
        courseTarget(animation.courseId),
        t,
      )
      point.z += Math.sin(Math.PI * t) * 0.16

      if (t >= 1) {
        if (animation.hitTarget) {
          animation = {
            type: 'hit',
            startedAt: now,
            duration: 780,
            from: { x: 0, y: 0.2, z: 1.0 },
            to: animation.hitTarget,
            height: animation.hitHeight,
          }
        } else {
          animation = null
        }
      }
      return point
    }

    const t = clamp(elapsed / animation.duration, 0, 1)
    const eased = easeOutCubic(t)
    const point = mixPoint(animation.from, animation.to, eased)
    point.z = Math.sin(Math.PI * t) * animation.height

    if (t >= 1) animation = null
    return point
  }

  function drawBall(point, currentCamera, now) {
    if (!point) {
      trail = []
      return
    }

    trail.push({ ...point, at: now })
    trail = trail.filter((item) => now - item.at < 260)

    // 落下地点マーカー
    if (animation?.type === 'hit' && animation.hitTarget) {
      const landing = project(
        { x: animation.hitTarget.x, y: animation.hitTarget.y, z: 0 },
        currentCamera,
      )
      if (landing) {
        const radius = clamp(landing.scale * 0.7, 5, 18)
        context.save()
        context.strokeStyle = 'rgba(245, 165, 36, 0.72)'
        context.lineWidth = 2
        context.beginPath()
        context.ellipse(landing.x, landing.y, radius, radius * 0.34, 0, 0, Math.PI * 2)
        context.stroke()
        context.restore()
      }
    }

    // 軌跡
    for (let index = 1; index < trail.length; index += 1) {
      const previous = project(trail[index - 1], currentCamera)
      const current = project(trail[index], currentCamera)
      if (!previous || !current) continue
      const alpha = (index / trail.length) * 0.55
      context.save()
      context.strokeStyle = `rgba(255, 245, 214, ${alpha})`
      context.lineWidth = 1 + alpha * 3
      context.beginPath()
      context.moveTo(previous.x, previous.y)
      context.lineTo(current.x, current.y)
      context.stroke()
      context.restore()
    }

    const shadow = project({ x: point.x, y: point.y, z: 0 }, currentCamera)
    const ball = project(point, currentCamera)
    if (!shadow || !ball) return

    context.save()
    context.fillStyle = 'rgba(0, 0, 0, 0.3)'
    context.beginPath()
    context.ellipse(shadow.x, shadow.y, 4, 2, 0, 0, Math.PI * 2)
    context.fill()

    const radius = clamp(ball.scale * 0.11, 2.2, 7)
    const glow = context.createRadialGradient(ball.x, ball.y, 0, ball.x, ball.y, radius * 2.2)
    glow.addColorStop(0, 'rgba(255, 252, 235, 0.95)')
    glow.addColorStop(0.45, 'rgba(255, 246, 214, 0.45)')
    glow.addColorStop(1, 'rgba(255, 246, 214, 0)')
    context.fillStyle = glow
    context.beginPath()
    context.arc(ball.x, ball.y, radius * 2.2, 0, Math.PI * 2)
    context.fill()

    context.fillStyle = '#fff8e8'
    context.strokeStyle = '#b9a77b'
    context.lineWidth = 1
    context.beginPath()
    context.arc(ball.x, ball.y, radius, 0, Math.PI * 2)
    context.fill()
    context.stroke()

    // ボールの縫い目
    context.strokeStyle = 'rgba(191, 64, 50, 0.7)'
    context.lineWidth = Math.max(0.7, radius * 0.2)
    context.beginPath()
    context.arc(ball.x - radius * 0.25, ball.y, radius * 0.75, -0.9, 0.9)
    context.stroke()
    context.restore()
  }

  function startAnimation() {
    if (!state?.lastPitch) return

    trail = []
    const target = BATTED_BALL_TARGETS[state.lastPitch.location] ?? null
    const isInPlay = state.lastPitch.kind === 'inplay'

    animation = {
      type: 'pitch',
      startedAt: performance.now(),
      duration: 520,
      courseId: state.lastPitch.courseId,
      hitTarget: isInPlay ? { ...target, z: 0.4 } : null,
      hitHeight: isInPlay ? (state.lastPitch.outcome === 'homerun' ? 16 : 7) : 0,
    }
  }

  function draw(now) {
    if (!running) return
    if (!state) {
      frame = requestAnimationFrame(draw)
      return
    }

    resize()

    const ballPoint = animationPoint(now)
    let targetPreset =
      state.phase === 'bat'
        ? CAMERA_PRESETS.bat
        : state.phase === 'pitch'
          ? CAMERA_PRESETS.pitch
          : CAMERA_PRESETS.field

    // 打球中はボールへ少しカメラを寄せる
    if (animation?.type === 'hit' && ballPoint) {
      targetPreset = {
        ...CAMERA_PRESETS.field,
        position: {
          x: ballPoint.x * 0.12,
          y: CAMERA_PRESETS.field.position.y,
          z: CAMERA_PRESETS.field.position.z,
        },
        target: {
          x: ballPoint.x * 0.34,
          y: 28 + ballPoint.y * 0.36,
          z: 0,
        },
      }
    }

    cameraPreset = lerpCamera(cameraPreset, targetPreset, 0.1)
    const currentCamera = camera()

    drawBackdrop()
    drawOutfield(currentCamera)
    drawInfield(currentCamera)
    drawStrikeZone(currentCamera)
    drawPlayers(currentCamera)
    drawBall(ballPoint, currentCamera, now)

    if (
      state.lastPitch?.outcome === 'homerun' &&
      animation?.type === 'hit' &&
      animation.hitHeight > 10
    ) {
      context.save()
      context.fillStyle = 'rgba(245, 165, 36, 0.95)'
      context.font = `800 ${clamp(viewport.width * 0.055, 18, 42)}px system-ui, sans-serif`
      context.textAlign = 'center'
      context.shadowColor = 'rgba(245, 165, 36, 0.8)'
      context.shadowBlur = 20
      context.fillText('HOME RUN', viewport.width / 2, viewport.height * 0.22)
      context.restore()
    }

    if (state.lastPitch && ['pitch', 'bat'].includes(state.phase)) {
      drawText(state.lastPitch.text, { x: 0, y: 4, z: 3.2 }, '#f5e7c8', currentCamera, 12)
    }

    drawVignette()

    lastFrameTime = now
    frame = requestAnimationFrame(draw)
  }

  function setCanvas(nextCanvas) {
    canvas = nextCanvas
    context = canvas.getContext('2d')
    resize()
  }

  function setState(nextState) {
    const previousLogLength = lastLogLength
    state = nextState
    lastLogLength = nextState?.log?.length ?? null

    if (previousLogLength === null) return
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
    state = null
    animation = null
  }

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
