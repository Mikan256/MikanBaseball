import { expect, test } from '@playwright/test'
import { pitchUntilBatting } from './helpers.js'

async function openGame(page) {
  await page.goto('/')
  await page.getByTestId('start').click()
  await page.getByTestId('start-game').click()
  await expect(page.getByTestId('inning')).toHaveText('1回 表')
}

test('球種を選んでメーターをリリースするとログが進む', async ({ page }) => {
  await openGame(page)

  const screen = page.getByTestId('game-screen')
  await expect(screen).toHaveAttribute('data-pitch-count', '0')
  await expect(page.getByTestId('match-canvas')).toBeVisible()

  await page.getByTestId('pitch-type-slider').click()
  await expect(page.getByTestId('pitch-type-slider')).toHaveClass(/selected/)

  await page.getByTestId('course-high-out').click()
  await expect(page.getByTestId('course-high-out')).toHaveClass(/selected/)
  await expect(page.getByTestId('release-pitch')).toBeEnabled()

  const before = await page.getByTestId('pitch-meter-marker').evaluate((el) => el.style.left)
  await page.waitForTimeout(200)
  const after = await page.getByTestId('pitch-meter-marker').evaluate((el) => el.style.left)
  expect(after).not.toBe(before)

  await page.getByTestId('release-pitch').click()

  await expect(screen).toHaveAttribute('data-pitch-count', '1')
  await expect(page.getByTestId('last-result')).toContainText('スライダー')
  await expect(page.getByTestId('game-log').locator('li')).toHaveCount(1)
  await expect(page.getByTestId('count')).toHaveText(/B [0-4] \/ S [0-2]/)
})

test('キーボードでもコース選択とリリースができる', async ({ page }) => {
  await openGame(page)

  await page.keyboard.press('5')
  await expect(page.getByTestId('release-pitch')).toBeEnabled()
  await page.keyboard.press('Space')

  await expect(page.getByTestId('game-screen')).toHaveAttribute('data-pitch-count', '1')
})

test('自分の攻撃では投球を見て打ち分けられる', async ({ page }) => {
  await openGame(page)
  await pitchUntilBatting(page)

  await expect(page.getByTestId('bat-controls')).toBeVisible()
  await expect(page.getByTestId('incoming-pitch')).not.toBeEmpty()
  await expect(page.getByTestId('bat-timing')).toBeVisible()

  const timingBefore = await page.getByTestId('bat-timing-marker').evaluate((el) => el.style.left)
  await page.waitForTimeout(200)
  const timingAfter = await page.getByTestId('bat-timing-marker').evaluate((el) => el.style.left)
  expect(timingAfter).not.toBe(timingBefore)

  await page.getByTestId('cursor-1-2').click()
  await expect(page.getByTestId('cursor-1-2')).toHaveClass(/selected/)

  const screen = page.getByTestId('game-screen')
  const before = Number(await screen.getAttribute('data-pitch-count'))

  await page.getByTestId('swing-contact').click()

  await expect(screen).toHaveAttribute('data-pitch-count', String(before + 1))
  await expect(page.getByTestId('last-result')).toBeVisible()
})

test('見送りと強振も選べる', async ({ page }) => {
  await openGame(page)
  await pitchUntilBatting(page)

  await expect(page.getByTestId('take')).toBeEnabled()
  await expect(page.getByTestId('swing-power')).toBeEnabled()
  await page.getByTestId('take').click()
  await expect(page.getByTestId('last-result')).toBeVisible()
})

test('最後まで自動で進めると結果画面になる', async ({ page }) => {
  await openGame(page)
  await page.getByTestId('auto-play').click()

  await expect(page.getByTestId('result-headline')).toBeVisible()
  await expect(page.getByTestId('final-score')).toBeVisible()
  await expect(page.getByTestId('rematch')).toBeVisible()

  const finalScore = await page.getByTestId('final-score').innerText()
  expect(finalScore).toMatch(/^\d+ - \d+$/)
})
