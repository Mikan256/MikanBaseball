import { expect, test } from '@playwright/test'
import { pitchUntilBatting, throwPitch } from './helpers.js'

// 3D描画を含むため、並列実行時は1球ずつの進行に時間がかかる
test.beforeEach(() => {
  test.setTimeout(120000)
})

async function openGame(page) {
  // フルスクリーンHUDはデスクトップ横長を基準に確認する
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/')
  await page.getByTestId('start').click()
  await page.getByTestId('start-game').click()
  await expect(page.getByTestId('inning')).toHaveText('1回 表')
}

/** 試合中に出たコンソールエラー / 未捕捉例外を集める */
function watchErrors(page) {
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  return errors
}

test('デスクトップ横長でフルスクリーンHUDと塁ダイヤモンドが表示される', async ({ page }) => {
  await openGame(page)

  const screen = page.getByTestId('game-screen')
  await expect(screen).toHaveAttribute('data-phase', 'pitch')
  await expect(page.getByTestId('match-canvas')).toBeVisible()
  await expect(page.getByTestId('base-diamond')).toBeVisible()
  for (const base of ['base-first', 'base-second', 'base-third']) {
    await expect(page.getByTestId(base)).toBeVisible()
  }

  // 操作デッキ（pitch-controls の親）が画面内に収まっていること
  const deck = page.getByTestId('pitch-controls').locator('..')
  await expect(deck).toBeVisible()
  const box = await deck.boundingBox()
  expect(box).not.toBeNull()
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(720)
  await expect(page.getByTestId('rotate-overlay')).toBeHidden()
})

test('打席の incoming-pitch に球速バッジが添えられる', async ({ page }) => {
  await openGame(page)
  await pitchUntilBatting(page)

  await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'bat')
  await expect(page.getByTestId('incoming-pitch')).toContainText(/km\/h/)
  await expect(page.getByTestId('pitch-speed').first()).toHaveText(/^\d+km\/h$/)
})

test('ミートすると接触フィードバックとタイミング評価が表示される', async ({ page }) => {
  await openGame(page)
  await pitchUntilBatting(page)

  const screen = page.getByTestId('game-screen')
  const before = Number(await screen.getAttribute('data-pitch-count'))
  await page.getByTestId('swing-contact').click()

  await expect(screen).toHaveAttribute('data-pitch-count', String(before + 1))
  const feedback = page.getByTestId('contact-feedback')
  const grade = page.getByTestId('timing-grade')
  await expect(feedback).toBeVisible()
  await expect(feedback).not.toBeEmpty()
  await expect(grade).toBeVisible()
  await expect(grade).toHaveText(/^[SABCD]$/)
  await expect(grade).toHaveAttribute('data-grade', /^[SABCD]$/)
  expect(await grade.innerText()).toBe(await grade.getAttribute('data-grade'))
})

test('キーボードで球種・コース・リリース・ミートができる', async ({ page }) => {
  await openGame(page)
  const screen = page.getByTestId('game-screen')

  // Q/W/E/R は球種リストの先頭から順に対応する
  for (const [key, type] of [
    ['q', 'straight'],
    ['w', 'slider'],
    ['e', 'curve'],
    ['r', 'changeup'],
  ]) {
    await page.keyboard.press(key)
    await expect(page.getByTestId(`pitch-type-${type}`)).toHaveClass(/selected/)
  }

  await page.keyboard.press('5')
  await expect(page.getByTestId('release-pitch')).toBeEnabled()
  await page.keyboard.press('Space')
  await expect(screen).toHaveAttribute('data-pitch-count', '1')

  await pitchUntilBatting(page)
  await expect(screen).toHaveAttribute('data-phase', 'bat')
  await expect(page.getByTestId('bat-timing-marker')).toBeVisible()

  const before = Number(await screen.getAttribute('data-pitch-count'))
  await page.keyboard.press('Enter')
  await expect(screen).toHaveAttribute('data-pitch-count', String(before + 1))
  await expect(page.getByTestId('timing-grade')).toHaveText(/^[SABCD]$/)
})

test('HUDの一連の操作でコンソールエラーが出ない', async ({ page }) => {
  const errors = watchErrors(page)
  await openGame(page)

  await throwPitch(page)
  await pitchUntilBatting(page)
  await page.getByTestId('swing-contact').click()
  await expect(page.getByTestId('contact-feedback')).not.toBeEmpty()

  expect(errors).toEqual([])
})
