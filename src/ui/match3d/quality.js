/**
 * 3D 描画品質の判定。
 *
 * 実 GPU では高品質（MSAA + シャドウ + 高 DPR）、SwiftShader などの
 * ソフトウェア描画では E2E を速く保つため低品質を選ぶ。
 * URL の ?quality=high|low|auto で上書きできる（既定は auto）。
 */

const SOFTWARE_PATTERN =
  /swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen|lavapipe|virgl|angle\s*\([^)]*software/i
const HARDWARE_PATTERN = /nvidia|geforce|radeon|\bamd\b|\bintel\b|apple|adreno|mali|powervr|arc\b/i

let cachedProfile = null

/** ブラウザがソフトウェア描画かどうかを一時的なコンテキストで調べる */
function probeRenderer() {
  if (typeof document === 'undefined') return { software: true, renderer: '' }
  let gl = null
  try {
    const probe = document.createElement('canvas')
    gl = probe.getContext('webgl2') || probe.getContext('webgl')
    if (!gl) return { software: true, renderer: '' }

    let renderer = ''
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    if (info) renderer = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || '')
    if (!renderer) renderer = String(gl.getParameter(gl.RENDERER) || '')

    // 情報が取れない／未知のレンダラーは安全側（低品質）に倒す
    const software = SOFTWARE_PATTERN.test(renderer) || !HARDWARE_PATTERN.test(renderer)
    return { software, renderer }
  } catch {
    return { software: true, renderer: '' }
  } finally {
    try {
      gl?.getExtension('WEBGL_lose_context')?.loseContext()
    } catch {
      // プローブ用コンテキストの破棄に失敗しても描画自体は継続できる
    }
  }
}

/**
 * 品質プロファイルを 1 度だけ解決する。
 * @returns {{ mode: 'high'|'low', pixelRatio: number, antialias: boolean, shadows: boolean,
 *            maxFrameMs: number, textScale: number, glowSize: number, exposure: number,
 *            fogDensity: number, renderer: string }}
 */
export function getQualityProfile() {
  if (cachedProfile) return cachedProfile

  let requested = 'auto'
  if (typeof window !== 'undefined') {
    try {
      requested = new URLSearchParams(window.location.search).get('quality') || 'auto'
    } catch {
      requested = 'auto'
    }
  }
  requested = ['high', 'low', 'auto'].includes(requested) ? requested : 'auto'

  const probe = probeRenderer()
  const mode = requested === 'auto' ? (probe.software ? 'low' : 'high') : requested
  const hardwareRatio =
    typeof window === 'undefined' ? 1 : Math.min(Math.max(window.devicePixelRatio || 1, 1), 1.5)

  cachedProfile =
    mode === 'high'
      ? {
          mode,
          pixelRatio: hardwareRatio,
          antialias: true,
          shadows: true,
          maxFrameMs: 1000 / 60,
          textScale: 2,
          glowSize: 256,
          exposure: 1.12,
          fogDensity: 0.0012,
          renderer: probe.renderer,
        }
      : {
          mode,
          pixelRatio: 0.9,
          antialias: false,
          shadows: false,
          maxFrameMs: 1000 / 30,
          textScale: 1,
          glowSize: 128,
          exposure: 1.05,
          fogDensity: 0.0016,
          renderer: probe.renderer,
        }

  return cachedProfile
}
