import * as THREE from '../../../vendor/three/three.module.js'
import { setFromGame } from './coords.js'

/** 選手の全高（メートル）。 */
export const PLAYER_HEIGHT = 1.8

/** リグが対応するポーズ名。未知の値は 'field' として扱う。 */
export const PLAYER_POSES = ['field', 'pitch', 'bat', 'swing', 'run', 'catch']

const DEFAULT_JERSEY = '#4a90d9'
const DEFAULT_SKIN = '#e1b38c'

// 体格の基準値。地面 y=0 から積み上げて全高 1.8m になるように決めてある。
const HIP_Y = 0.92 // 股関節の高さ
const HIP_X = 0.085 // 脚の左右間隔
const SHOULDER_X = 0.175 // 肩の左右間隔
const SHOULDER_Y = 0.5 // 股関節から見た肩の高さ
const HEAD_Y = 0.745 // 股関節から見た頭の中心
const THIGH_LEN = 0.424 // 太もも（カプセル全長）
const SHIN_LEN = 0.42 // すね（カプセル全長）
const SLEEVE_LEN = 0.284 // 二の腕（袖）
const FOREARM_LEN = 0.27 // 前腕

// ポーズ内の周期（秒）
const PITCH_CYCLE = 1.1
const SWING_DURATION = 0.35
const RUN_CYCLE = 0.5

/** 数値を範囲内に丸める。 */
function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value
}

/** 線形補間。 */
function lerp(from, to, t) {
  return from + (to - from) * t
}

/** 加速して減速する補間（0..1）。 */
function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)
}

/** 勢いよく出て止まる補間（0..1）。 */
function easeOut(t) {
  const u = 1 - t
  return 1 - u * u * u
}

/** 未知のポーズを 'field' に落とす。 */
function normalizePose(pose) {
  return PLAYER_POSES.includes(pose) ? pose : 'field'
}

/**
 * ローポリの野球選手リグを作る。
 * 選手は原点に立ち、three.js の +z 方向を向く。
 * 戻り値の group をシーンに追加して update() を毎フレーム呼ぶ。
 */
export function createPlayerRig({
  jersey = DEFAULT_JERSEY,
  skin = DEFAULT_SKIN,
  pose = 'field',
} = {}) {
  const group = new THREE.Group()

  // ジオメトリは 1 リグにつき 1 つずつ作り、左右で共有する。
  const geos = {
    thigh: new THREE.CapsuleGeometry(0.062, 0.3, 2, 8),
    shin: new THREE.CapsuleGeometry(0.05, 0.32, 2, 8),
    cleat: new THREE.BoxGeometry(0.11, 0.06, 0.24),
    torso: new THREE.CapsuleGeometry(0.128, 0.4, 3, 10),
    belt: new THREE.CylinderGeometry(0.134, 0.134, 0.06, 10),
    head: new THREE.SphereGeometry(0.12, 12, 8),
    cap: new THREE.SphereGeometry(0.126, 12, 5, 0, Math.PI * 2, 0, Math.PI * 0.52),
    brim: new THREE.BoxGeometry(0.2, 0.018, 0.13),
    sleeve: new THREE.CapsuleGeometry(0.052, 0.18, 2, 8),
    forearm: new THREE.CapsuleGeometry(0.04, 0.19, 2, 8),
    glove: new THREE.SphereGeometry(0.078, 8, 6),
    bat: new THREE.CylinderGeometry(0.014, 0.032, 0.76, 6),
    shadow: new THREE.CircleGeometry(0.42, 20),
  }

  const materials = {
    skin: new THREE.MeshLambertMaterial({ color: skin }),
    pants: new THREE.MeshLambertMaterial({ color: '#f2f2ee' }),
    jersey: new THREE.MeshLambertMaterial({ color: jersey }),
    dark: new THREE.MeshLambertMaterial({ color: '#24262b' }),
    glove: new THREE.MeshLambertMaterial({ color: '#7a4a26' }),
    bat: new THREE.MeshLambertMaterial({ color: '#d9b273' }),
    // 接地影はライティングの影響を受けない平たい円
    shadow: new THREE.MeshBasicMaterial({
      color: '#000000',
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    }),
  }

  // --- 脚（股関節 → 膝 → 足首） ---------------------------------------------
  const buildLeg = (side) => {
    const pivot = new THREE.Group()
    pivot.position.set(side * HIP_X, HIP_Y, 0)

    const thigh = new THREE.Mesh(geos.thigh, materials.pants)
    thigh.position.y = -THIGH_LEN / 2
    pivot.add(thigh)

    const knee = new THREE.Group()
    knee.position.y = -THIGH_LEN
    pivot.add(knee)

    const shin = new THREE.Mesh(geos.shin, materials.pants)
    shin.position.y = -SHIN_LEN / 2
    knee.add(shin)

    // 足首は update() の最後で常に水平に戻すので、靴底が地面に平行になる
    const ankle = new THREE.Group()
    ankle.position.y = -SHIN_LEN
    knee.add(ankle)

    const cleat = new THREE.Mesh(geos.cleat, materials.dark)
    cleat.position.set(0, -0.046, 0.03)
    ankle.add(cleat)

    group.add(pivot)
    return { pivot, knee, ankle }
  }

  const legL = buildLeg(-1)
  const legR = buildLeg(1)

  // --- 上半身 ----------------------------------------------------------------
  const hips = new THREE.Group()
  hips.position.y = HIP_Y
  group.add(hips)

  const torso = new THREE.Mesh(geos.torso, materials.jersey)
  torso.position.y = 0.325
  hips.add(torso)

  const belt = new THREE.Mesh(geos.belt, materials.dark)
  belt.position.y = 0.045
  hips.add(belt)

  // 頭とキャップ（キャップはユニフォームと同じ材質で色を揃える）
  const headPivot = new THREE.Group()
  headPivot.position.y = HEAD_Y
  hips.add(headPivot)

  const head = new THREE.Mesh(geos.head, materials.skin)
  headPivot.add(head)

  const cap = new THREE.Mesh(geos.cap, materials.jersey)
  cap.position.y = 0.012
  headPivot.add(cap)

  const brim = new THREE.Mesh(geos.brim, materials.jersey)
  brim.position.set(0, 0.02, 0.105)
  headPivot.add(brim)

  // --- 腕（肩 → 肘） ---------------------------------------------------------
  const buildArm = (side) => {
    const pivot = new THREE.Group()
    pivot.position.set(side * SHOULDER_X, SHOULDER_Y, 0)

    const sleeve = new THREE.Mesh(geos.sleeve, materials.jersey)
    sleeve.position.y = -SLEEVE_LEN / 2
    pivot.add(sleeve)

    const elbow = new THREE.Group()
    elbow.position.y = -SLEEVE_LEN
    pivot.add(elbow)

    const forearm = new THREE.Mesh(geos.forearm, materials.skin)
    forearm.position.y = -FOREARM_LEN / 2
    elbow.add(forearm)

    hips.add(pivot)
    return { pivot, elbow }
  }

  // 左腕がグラブ（利き腕は右）
  const armL = buildArm(-1)
  const armR = buildArm(1)

  const glove = new THREE.Mesh(geos.glove, materials.glove)
  glove.position.set(0, -FOREARM_LEN - 0.03, 0.03)
  glove.scale.set(1, 1.15, 0.55)
  armL.elbow.add(glove)

  // --- バット（右手の先に付ける） --------------------------------------------
  const batPivot = new THREE.Group()
  batPivot.position.y = -FOREARM_LEN
  armR.elbow.add(batPivot)

  const bat = new THREE.Mesh(geos.bat, materials.bat)
  bat.position.y = 0.4
  batPivot.add(bat)

  // --- 接地影 ----------------------------------------------------------------
  const shadow = new THREE.Mesh(geos.shadow, materials.shadow)
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.012
  group.add(shadow)

  // --- ポーズ制御 ------------------------------------------------------------
  let currentPose = normalizePose(pose)
  let appliedPose = null
  // 現在のポーズに切り替わってからの経過秒（1 回だけ再生するポーズ用）
  let poseElapsed = 0

  /** 全ボーンを基準姿勢に戻す。 */
  function resetPose() {
    hips.position.set(0, HIP_Y, 0)
    hips.rotation.set(0, 0, 0)
    torso.rotation.set(0, 0, 0)
    headPivot.rotation.set(0, 0, 0)
    legL.pivot.rotation.set(0, 0, 0)
    legL.knee.rotation.set(0, 0, 0)
    legR.pivot.rotation.set(0, 0, 0)
    legR.knee.rotation.set(0, 0, 0)
    armL.pivot.rotation.set(0, 0, 0)
    armL.elbow.rotation.set(0, 0, 0)
    armR.pivot.rotation.set(0, 0, 0)
    armR.elbow.rotation.set(0, 0, 0)
    batPivot.rotation.set(0, 0, 0)
    bat.visible = false
    glove.visible = true
  }

  /** 守備の構え。グラブ側の腕を前に出して軽く膝を曲げる。 */
  function applyField(elapsed) {
    const breathe = Math.sin(elapsed * 1.4) * 0.015
    hips.position.y = HIP_Y - 0.01 + breathe
    torso.rotation.x = -0.08
    headPivot.rotation.x = 0.06
    legL.pivot.rotation.set(-0.14, 0, -0.05)
    legL.knee.rotation.x = 0.24
    legR.pivot.rotation.set(0.06, 0, 0.06)
    legR.knee.rotation.x = 0.14
    armL.pivot.rotation.set(-0.85, 0.12, -0.16)
    armL.elbow.rotation.x = 0.95
    armR.pivot.rotation.set(0.2, -0.1, 0.14)
    armR.elbow.rotation.x = 0.45
  }

  /** 投球。ワインドアップ → リリース → 戻りを繰り返す。 */
  function applyPitch() {
    const p = (poseElapsed % PITCH_CYCLE) / PITCH_CYCLE
    let armX
    if (p < 0.42) {
      armX = lerp(0.15, 2.75, easeInOut(p / 0.42))
    } else if (p < 0.64) {
      armX = lerp(2.75, -0.85, easeOut((p - 0.42) / 0.22))
    } else {
      armX = lerp(-0.85, 0.15, easeInOut((p - 0.64) / 0.36))
    }

    const twist = Math.sin(p * Math.PI * 2)
    const stride = twist * 0.25

    hips.position.y = HIP_Y - 0.02
    hips.rotation.y = twist * 0.12
    torso.rotation.x = -0.05
    torso.rotation.y = twist * 0.18
    headPivot.rotation.x = 0.05
    legL.pivot.rotation.set(-0.25 - stride, 0, -0.06)
    legL.knee.rotation.x = 0.3
    legR.pivot.rotation.set(0.15 + stride, 0, 0.06)
    legR.knee.rotation.x = 0.12
    armR.pivot.rotation.set(armX, 0, 0.1)
    armR.elbow.rotation.x = 0.35
    armL.pivot.rotation.set(-1.15, 0.1, -0.2)
    armL.elbow.rotation.x = 0.7
  }

  /** 打席。バットを構えて小さく揺らす。 */
  function applyBat(elapsed) {
    const waggle = Math.sin(elapsed * 2.4) * 0.06
    hips.position.y = HIP_Y - 0.03
    hips.rotation.y = 0.18
    torso.rotation.x = -0.06
    torso.rotation.y = 0.14
    headPivot.rotation.y = -0.25
    legL.pivot.rotation.set(-0.4, 0.1, -0.1)
    legL.knee.rotation.x = 0.4
    legR.pivot.rotation.set(0.2, -0.1, 0.08)
    legR.knee.rotation.x = 0.18
    armL.pivot.rotation.set(0.5, -0.15, 0.3)
    armL.elbow.rotation.x = -1.6
    armR.pivot.rotation.set(0.55, 0.1, -0.25)
    armR.elbow.rotation.x = -1.7
    batPivot.rotation.x = 0.7 + waggle
    bat.visible = true
    glove.visible = false
  }

  /** スイング。0.35 秒で振り切り、そのままフォロースルーを保つ。 */
  function applySwing() {
    const e = easeOut(clamp(poseElapsed / SWING_DURATION, 0, 1))
    hips.position.y = HIP_Y - 0.035
    hips.rotation.y = lerp(0.18, -0.55, e)
    torso.rotation.x = -0.06
    torso.rotation.y = lerp(0.14, -0.3, e)
    headPivot.rotation.y = lerp(-0.25, 0.2, e)
    legL.pivot.rotation.set(-0.4, 0.1, -0.1)
    legL.knee.rotation.x = 0.45
    legR.pivot.rotation.set(0.2, -0.1, 0.08)
    legR.knee.rotation.x = 0.2
    armL.pivot.rotation.set(lerp(0.5, -0.6, e), lerp(-0.15, 0.1, e), 0.3)
    armL.elbow.rotation.x = lerp(-1.6, -0.7, e)
    armR.pivot.rotation.set(lerp(0.55, -1.15, e), lerp(0.1, -0.5, e), -0.25)
    armR.elbow.rotation.x = lerp(-1.7, -0.45, e)
    batPivot.rotation.x = lerp(0.7, 0.15, e)
    bat.visible = true
    glove.visible = false
  }

  /** 走塁。脚と腕を交互に振る（0.5 秒周期）。 */
  function applyRun() {
    const w = ((poseElapsed % RUN_CYCLE) / RUN_CYCLE) * Math.PI * 2
    const s = Math.sin(w)
    hips.position.y = HIP_Y - 0.02
    hips.rotation.y = s * 0.1
    torso.rotation.x = -0.16
    headPivot.rotation.x = 0.12
    legL.pivot.rotation.set(s * 0.8, 0, -0.04)
    legR.pivot.rotation.set(-s * 0.8, 0, 0.04)
    legL.knee.rotation.x = 0.15 + Math.max(0, -s)
    legR.knee.rotation.x = 0.15 + Math.max(0, s)
    armL.pivot.rotation.set(-s * 0.85, 0.05, -0.15)
    armR.pivot.rotation.set(s * 0.85, -0.05, 0.15)
    armL.elbow.rotation.x = 0.8
    armR.elbow.rotation.x = 0.8
    glove.visible = false
  }

  /** 捕球。グラブを高く上げる。 */
  function applyCatch() {
    hips.position.y = HIP_Y - 0.03
    torso.rotation.x = 0.06
    headPivot.rotation.x = -0.15
    legL.pivot.rotation.set(-0.18, 0, -0.08)
    legL.knee.rotation.x = 0.4
    legR.pivot.rotation.set(0.12, 0, 0.08)
    legR.knee.rotation.x = 0.34
    armL.pivot.rotation.set(-2.35, 0.18, -0.22)
    armL.elbow.rotation.x = -0.45
    armR.pivot.rotation.set(0.05, 0, 0.2)
    armR.elbow.rotation.x = 0.55
  }

  /** ポーズを切り替える。次の update() で反映される。 */
  function setPose(nextPose) {
    currentPose = normalizePose(nextPose)
  }

  /** ユニフォームとキャップの色を変える。 */
  function setJersey(color) {
    materials.jersey.color.set(color)
  }

  /**
   * 毎フレームの更新。elapsed は起動からの経過秒、delta は前フレームからの秒数。
   * 内部でオブジェクトを確保しない。
   */
  function update(elapsed, delta) {
    if (currentPose !== appliedPose) {
      appliedPose = currentPose
      poseElapsed = 0
    } else if (delta > 0) {
      poseElapsed += delta
    }

    resetPose()

    switch (currentPose) {
      case 'pitch':
        applyPitch()
        break
      case 'bat':
        applyBat(elapsed)
        break
      case 'swing':
        applySwing()
        break
      case 'run':
        applyRun()
        break
      case 'catch':
        applyCatch()
        break
      default:
        applyField(elapsed)
        break
    }

    // 足首を水平に保ち、靴底が地面と平行になるようにする
    legL.ankle.rotation.x = -(legL.pivot.rotation.x + legL.knee.rotation.x)
    legR.ankle.rotation.x = -(legR.pivot.rotation.x + legR.knee.rotation.x)
  }

  /** このリグが作ったジオメトリとマテリアルを破棄する。 */
  function dispose() {
    for (const geometry of Object.values(geos)) geometry.dispose()
    for (const material of Object.values(materials)) material.dispose()
  }

  // 初期ポーズを即座に反映しておく
  update(0, 0)

  return { group, setPose, setJersey, update, dispose }
}

/**
 * リグをゲーム座標 (x: 左右, y: 奥行き, z: 高さ) に配置する。
 * z は地面からの高さなので通常は 0。
 */
export function placeRig(rig, x, y, z = 0) {
  return setFromGame(rig.group.position, x, y, z)
}
