import { ZipArchive } from 'archiver'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = join(root, 'dist')
const releaseDir = join(root, 'release')
const indexPath = join(distDir, 'index.html')
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const zipPath = join(releaseDir, `mikanbaseball-${packageJson.version}-flaxia.zip`)

// 配布ドキュメントにはZIP容量の上限が明記されていないため、保守的な警告閾値を設ける。
// Flaxia側で上限が判明した場合は RELEASE_MAX_BYTES で上書きする。
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024
const maxBytes = Number.parseInt(process.env.RELEASE_MAX_BYTES ?? '', 10) || DEFAULT_MAX_BYTES

function fail(message) {
  console.error(`[release] エラー: ${message}`)
  process.exit(1)
}

function formatBytes(bytes) {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KiB`
    : `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
}

function listFiles(dir) {
  const result = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) result.push(...listFiles(path))
    else if (entry.isFile()) result.push(path)
  }
  return result
}

if (!existsSync(indexPath)) {
  fail('dist/index.html が見つかりません。先に npm run build を実行してください。')
}

const html = readFileSync(indexPath, 'utf8')
const absolutePath = html.match(/(?:src|href)=["']\/assets\/[^"']+["']/i)
if (absolutePath) {
  fail(
    `index.html が絶対パス ${absolutePath[0]} を参照しています。vite.config.js の base: './' を確認してください。`,
  )
}

const files = listFiles(distDir)
if (files.length === 0) fail('dist/ にファイルがありません。')

const relFiles = files.map((file) => relative(distDir, file).split(sep).join('/')).sort()
const forbidden = relFiles.filter((name) => {
  const segments = name.split('/')
  return (
    segments.includes('node_modules') ||
    segments.includes('vendor') ||
    name === 'sdk/game.js' ||
    segments[0] === 'sdk'
  )
})
if (forbidden.length > 0) {
  fail(`配布に含められないファイルがあります: ${forbidden.join(', ')}`)
}

rmSync(releaseDir, { recursive: true, force: true })
mkdirSync(releaseDir, { recursive: true })

console.log('[release] 同梱ファイル:')
for (const name of relFiles) console.log(`  ${name}`)

await new Promise((resolvePromise, rejectPromise) => {
  const output = createWriteStream(zipPath)
  const archive = new ZipArchive({ zlib: { level: 9 } })
  output.on('close', resolvePromise)
  output.on('error', rejectPromise)
  archive.on('error', rejectPromise)
  archive.pipe(output)
  // 第2引数 false で dist/ の中身をZIPルートに配置する（余分なトップフォルダを作らない）
  archive.directory(distDir, false)
  archive.finalize()
})

const zipSize = statSync(zipPath).size
console.log(`[release] 出力: ${relative(root, zipPath)}`)
console.log(`[release] サイズ: ${formatBytes(zipSize)} (${zipSize} bytes)`)
console.log(`[release] ファイル数: ${relFiles.length}`)
console.log(`[release] 警告閾値: ${formatBytes(maxBytes)}`)
if (zipSize > maxBytes) {
  console.warn(
    `[release] 警告: ZIPサイズ ${formatBytes(zipSize)} が閾値 ${formatBytes(maxBytes)} を超過しています。`,
  )
}
