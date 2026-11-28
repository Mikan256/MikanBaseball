/**
 * 打球コンタクト演出（DOM 依存・matchView 内部専用）。
 * リグは作り直さず、1 つのグループを毎回再利用する。
 */

import * as THREE from 'three'
import { setFromGame } from './coords.js'

const CONTACT_MS = 320

/** ボールを遠くからでも見失わないための発光テクスチャ */
export function createGlowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d')
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64)
  gradient.addColorStop(0, 'rgba(255, 253, 240, 0.98)')
  gradient.addColorStop(0.32, 'rgba(255, 247, 210, 0.6)')
  gradient.addColorStop(0.68, 'rgba(255, 226, 150, 0.16)')
  gradient.addColorStop(1, 'rgba(255, 226, 150, 0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 128, 128)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * ホームベース付近に出るコンタクトの光と輪。
 * trigger() で位置と開始時刻を渡し、update() で減衰させる。
 */
export function createContactEffect(glowTexture) {
  const group = new THREE.Group()

  const ringGeometry = new THREE.RingGeometry(0.28, 0.46, 28)
  ringGeometry.rotateX(-Math.PI / 2)
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: '#ffe6a6',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  })
  const ring = new THREE.Mesh(ringGeometry, ringMaterial)
  group.add(ring)

  const flashMaterial = new THREE.SpriteMaterial({
    map: glowTexture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const flash = new THREE.Sprite(flashMaterial)
  group.add(flash)

  group.visible = false
  let startedAt = -Infinity

  /** コンタクト位置（ゲーム座標）で演出を始める */
  function trigger(x, y, z, now) {
    setFromGame(group.position, x, y, z)
    startedAt = now
    group.visible = true
    ring.scale.setScalar(1)
    ringMaterial.opacity = 0.95
    flashMaterial.opacity = 1
    flash.scale.setScalar(1.8)
  }

  /** 前回の trigger() からの経過時刻で減衰させる */
  function update(now) {
    if (!group.visible) return
    const t = (now - startedAt) / CONTACT_MS
    if (t >= 1) {
      group.visible = false
      return
    }
    const fade = 1 - t
    ring.scale.setScalar(1 + t * 3.6)
    ringMaterial.opacity = fade * fade * 0.95
    flashMaterial.opacity = fade * fade
    flash.scale.setScalar(1.8 + t * 2.4)
  }

  function dispose() {
    ringGeometry.dispose()
    ringMaterial.dispose()
    flashMaterial.dispose()
  }

  return { group, trigger, update, dispose }
}
