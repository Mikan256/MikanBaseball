#!/usr/bin/env node
/**
 * 依存ゼロの静的ファイルサーバ。
 * ビルド不要構成のため、index.html を HTTP 経由で配信する役割だけ担う。
 * ブラウザは ES Modules を file:// では読み込めないため 반드시 HTTP で配信すること。
 *
 * 使い方:
 *   node scripts/serve.js [--port 4173] [--host 127.0.0.1]
 *   PORT=3000 node scripts/serve.js
 */
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

/** --port 1234 / --port=1234 の両形式を解釈する */
function readArg(name, fallback) {
  const prefix = `--${name}=`
  const flag = `--${name}`
  const index = process.argv.indexOf(flag)
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1]
  const inline = process.argv.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  return fallback
}

// 环境的变量 HOST は環境固有の値が入っていることがあるため使わない
const port = Number(readArg('port', process.env.PORT ?? 4173))
const host = readArg('host', process.env.MIKAN_HOST ?? '127.0.0.1')

/** URL パスを ROOT 配下の安全なファイルパスへ変換する（ディレクトリトラバーサル対策） */
function resolveSafePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0])
  const relative = normalize(decoded).replace(/^(\.\.[/\\])+/, '')
  const absolute = join(ROOT, relative)
  if (absolute !== ROOT && !absolute.startsWith(ROOT + sep)) return null
  return absolute
}

async function findFile(pathname) {
  const target = resolveSafePath(pathname)
  if (!target) return null

  try {
    const stats = await stat(target)
    if (stats.isDirectory()) {
      const indexPath = join(target, 'index.html')
      const indexStats = await stat(indexPath)
      return indexStats.isFile() ? { path: indexPath, size: indexStats.size } : null
    }
    return { path: target, size: stats.size }
  } catch {
    return null
  }
}

const server = createServer(async (req, res) => {
  const file = await findFile(req.url ?? '/')

  if (!file) {
    const notFound = join(ROOT, '404.html')
    try {
      const errorPage = await stat(notFound)
      res.writeHead(404, {
        'Content-Type': MIME_TYPES['.html'],
        'Content-Length': errorPage.size,
      })
      createReadStream(notFound).pipe(res)
      return
    } catch {
      res.writeHead(404, { 'Content-Type': MIME_TYPES['.html'] })
      res.end('<h1>404 Not Found</h1>')
      return
    }
  }

  res.writeHead(200, {
    'Content-Type': MIME_TYPES[extname(file.path).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': file.size,
    // 開発中は常に最新を反映させるためキャッシュを無効化
    'Cache-Control': 'no-store',
  })
  createReadStream(file.path).pipe(res)
})

server.listen(port, host, () => {
  const address = server.address()
  const shown = typeof address === 'object' && address ? `${address.address}:${address.port}` : host
  console.log(`MikanBaseball dev server: http://${shown}/`)
})
