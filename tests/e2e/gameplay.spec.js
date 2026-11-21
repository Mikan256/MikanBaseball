import { expect, test } from '@playwright/test'

const COURSE_IDS = ['high-out', 'high-center', 'low-out', 'middle-out', 'middle-center', 'low-in']

async function openGame(page) {
  await page.goto('/')
  await page.getByTestId('start').click()
  await page.getByTestId('start-game').click()
  await expect(page.getByTestId('inning')).toHaveText('1回 表')
}

/** 表の攻撃が終わって自分の打席になるまで投げる */
async function pitchUntilBatting(page) {
  for (let index = 0; index < 300; index += 1) {
    if (await page.getByTestId('bat-controls').count()) return
    await page.getByTestId(`course-${COURSE_IDS[index % COURSE_IDS.length]}`).click()
  }
  throw new Error('打席まで到達しませんでした')
}

test('球種を選んでコースへ投げるとログが進む', async ({ page }) => {
  await openGame(page)

  const screen = page.getByTestId('game-screen')
  await expect(screen).toHaveAttribute('data-pitch-count', '0')

  await page.getByTestId('pitch-type-slider').click()
  await expect(page.getByTestId('pitch-type-slider')).toHaveClass(/selected/)

  await page.getByTestId('course-high-out').click()

  await expect(screen).toHaveAttribute('data-pitch-count', '1')
  await expect(page.getByTestId('last-result')).toContainText('スライダー')
  await expect(page.getByTestId('game-log').locator('li')).toHaveCount(1)
  await expect(page.getByTestId('count')).toHaveText(/B [0-4] \/ S [0-2]/)
})

test('自分の攻撃では投球を見て打ち分けられる', async ({ page }) => {
  await openGame(page)
  await pitchUntilBatting(page)

  await expect(page.getByTestId('bat-controls')).toBeVisible()
  await expect(page.getByTestId('incoming-pitch')).not.toBeEmpty()

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
