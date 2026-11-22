/**
 * 疑似3D用のカメラと透視投影。
 *
 * ワールド座標はメートル単位:
 * - x: 左右（プラスが右翼方向）
 * - y: ホームベースからの奥行き
 * - z: 高さ
 *
 * 3Dモデルは使わず、投影した座標へ2Dの図形を描く。
 */

const NEAR = 0.4

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length }
}

const WORLD_UP = { x: 0, y: 0, z: 1 }

/** 位置と注視点からカメラを作る */
export function createCamera({ position, target, fov = 52 }) {
  const forward = normalize(subtract(target, position))
  const right = normalize(cross(forward, WORLD_UP))
  const up = normalize(cross(right, forward))

  return { position, target, fov, forward, right, up }
}

/**
 * ワールド座標を画面座標へ投影する。
 * カメラの後ろにある点は null を返す。
 */
export function projectPoint(camera, point, viewport) {
  const relative = subtract(point, camera.position)
  const depth = dot(relative, camera.forward)
  if (depth <= NEAR) return null

  const aspect = viewport.width / Math.max(1, viewport.height)
  const focal = viewport.height / 2 / Math.tan((camera.fov * Math.PI) / 360)
  const x = (dot(relative, camera.right) / depth) * focal + viewport.width / 2
  const y = viewport.height / 2 - (dot(relative, camera.up) / depth) * focal

  return {
    x,
    y,
    depth,
    scale: focal / depth,
    aspect,
  }
}

/** 2つのカメラ設定を補間する */
export function lerpCamera(from, to, amount) {
  const t = Math.min(1, Math.max(0, amount))
  const mix = (a, b) => a + (b - a) * t

  return {
    position: {
      x: mix(from.position.x, to.position.x),
      y: mix(from.position.y, to.position.y),
      z: mix(from.position.z, to.position.z),
    },
    target: {
      x: mix(from.target.x, to.target.x),
      y: mix(from.target.y, to.target.y),
      z: mix(from.target.z, to.target.z),
    },
    fov: mix(from.fov, to.fov),
  }
}

/** 試合状況に応じたカメラ設定 */
export const CAMERA_PRESETS = {
  pitch: {
    position: { x: 0, y: -8.5, z: 5.2 },
    target: { x: 0, y: 13, z: 0.9 },
    fov: 52,
  },
  bat: {
    position: { x: 0, y: -10, z: 4.5 },
    target: { x: 0, y: 18.44, z: 1.3 },
    fov: 46,
  },
  field: {
    position: { x: 0, y: -12, z: 12 },
    target: { x: 0, y: 46, z: 0 },
    fov: 54,
  },
}
