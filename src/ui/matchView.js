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

  function drawOutfield(currentCamera) {
    const fence = fencePoints(20)
    fillPolygon([{ x: 0, y: 0, z: 0 }, ...fence], FIELD_GREEN, currentCamera)
    fillPolygon(
      [
        { x: 0, y: 0, z: 0 },
        { x: -48, y: 82, z: 0 },
        { x: 0, y: 92, z: 0 },
        { x: 48, y: 82, z: 0 },
      ],
      FIELD_DARK,
      currentCamera,
      0.36,
    )

    for (let index = 0; index < fence.length - 1; index += 1) {
      drawLine(fence[index], fence[index + 1], '#d6e6d6', 2, currentCamera)
    }

    drawLine({ x: 0, y: 0, z: 0 }, FOUL_POLES.left, LINE, 2, currentCamera)
    drawLine({ x: 0, y: 0, z: 0 }, FOUL_POLES.right, LINE, 2, currentCamera)
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

  function drawPlayer(position, color, label, currentCamera, highlight = false) {
    const ground = project({ ...position, z: 0 }, currentCamera)
    const head = project({ ...position, z: 1.78 }, currentCamera)
    if (!ground || !head) return

    const height = Math.max(8, ground.y - head.y)
    const bodyWidth = Math.max(3, height * 0.22)
    const headRadius = Math.max(3, height * 0.23)

    context.save()
    context.fillStyle = 'rgba(0, 0, 0, 0.28)'
    context.beginPath()
    context.ellipse(ground.x, ground.y, bodyWidth * 1.5, bodyWidth * 0.55, 0, 0, Math.PI * 2)
    context.fill()

    if (highlight) {
      context.strokeStyle = 'rgba(245, 165, 36, 0.9)'
      context.lineWidth = 2
      context.beginPath()
      context.ellipse(ground.x, ground.y, bodyWidth * 2.1, bodyWidth * 0.8, 0, 0, Math.PI * 2)
      context.stroke()
    }

    context.strokeStyle = color
    context.lineWidth = bodyWidth
    context.lineCap = 'round'
    context.beginPath()
    context.moveTo(ground.x, ground.y - bodyWidth * 0.4)
    context.lineTo(head.x, head.y + headRadius * 0.7)
    context.stroke()

    context.fillStyle = color
    context.beginPath()
    context.arc(head.x, head.y, headRadius, 0, Math.PI * 2)
    context.fill()

    context.fillStyle = 'rgba(255, 255, 255, 0.78)'
    context.font = `600 ${clamp(height * 0.18, 8, 12)}px system-ui, sans-serif`
    context.textAlign = 'center'
    context.fillText(label, ground.x, ground.y + clamp(height * 0.3, 9, 16))
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
      drawPlayer(position, defenseColor, positionId, currentCamera, positionId === highlightPitcher)
    }

    // 打者（ホームベース付近）
    if (!state.finished) {
      drawPlayer({ x: 0, y: 0.1 }, offenseColor, '打者', currentCamera, highlightBatter)
    }

    // 走者
    BASE_POSITIONS.forEach((base, index) => {
      if (!state.runners[index]) return
      drawPlayer(base, offenseColor, '走', currentCamera)
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

  function drawBall(currentCamera, now) {
    const point = animationPoint(now)
    if (!point) return

    const shadow = project({ x: point.x, y: point.y, z: 0 }, currentCamera)
    const ball = project(point, currentCamera)
    if (!shadow || !ball) return

    context.save()
    context.fillStyle = 'rgba(0, 0, 0, 0.28)'
    context.beginPath()
    context.ellipse(shadow.x, shadow.y, 4, 2, 0, 0, Math.PI * 2)
    context.fill()

    context.fillStyle = '#fff8e8'
    context.strokeStyle = '#b9a77b'
    context.lineWidth = 1
    context.beginPath()
    context.arc(ball.x, ball.y, clamp(ball.scale * 0.11, 2.2, 6), 0, Math.PI * 2)
    context.fill()
    context.stroke()
    context.restore()
  }

  function startAnimation() {
    if (!state?.lastPitch) return

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

    const targetPreset =
      state.phase === 'bat'
        ? CAMERA_PRESETS.bat
        : state.phase === 'pitch'
          ? CAMERA_PRESETS.pitch
          : CAMERA_PRESETS.field
    cameraPreset = lerpCamera(cameraPreset, targetPreset, 0.1)
    const currentCamera = camera()

    const gradient = context.createLinearGradient(0, 0, 0, viewport.height)
    gradient.addColorStop(0, '#0a1826')
    gradient.addColorStop(0.55, '#132b35')
    gradient.addColorStop(1, '#0c1a22')
    context.fillStyle = gradient
    context.fillRect(0, 0, viewport.width, viewport.height)

    drawOutfield(currentCamera)
    drawInfield(currentCamera)
    drawStrikeZone(currentCamera)
    drawPlayers(currentCamera)
    drawBall(currentCamera, now)

    if (state.lastPitch && ['pitch', 'bat'].includes(state.phase)) {
      drawText(state.lastPitch.text, { x: 0, y: 4, z: 3.2 }, '#f5e7c8', currentCamera, 12)
    }

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
