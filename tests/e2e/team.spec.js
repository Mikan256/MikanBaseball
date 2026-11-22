import { expect, test } from '@playwright/test'

test('タイトル画面からチーム編成に進める', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'みかん野球' })).toBeVisible()

  await page.getByTestId('start').click()

  await expect(page.getByRole('heading', { name: 'チーム編成' })).toBeVisible()
  await expect(page.getByTestId('lineup').locator('li')).toHaveCount(9)
})

test('9 人の守備位置がすべて違う', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('start').click()

  const lineup = page.getByTestId('lineup').locator('li')
  const positions = await lineup.evaluateAll((items) => items.map((item) => item.dataset.position))

  expect(new Set(positions).size).toBe(9)
  expect(positions).toContain('P')
  expect(positions).toContain('CF')
})

test('打席順の上へボタンで並び替えできる', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('start').click()

  const rows = page.getByTestId('lineup').locator('li')
  const firstPosition = await rows.nth(0).getAttribute('data-position')
  const secondPosition = await rows.nth(1).getAttribute('data-position')
  const firstPlayer = await page.getByTestId(`slot-name-${firstPosition}`).innerText()
  const secondPlayer = await page.getByTestId(`slot-name-${secondPosition}`).innerText()

  await page.getByTestId('order-down-0').click()

  await expect(rows.nth(0)).toHaveAttribute('data-position', secondPosition)
  await expect(rows.nth(1)).toHaveAttribute('data-position', firstPosition)
  await expect(rows.nth(0)).toContainText(secondPlayer)
  await expect(rows.nth(1)).toContainText(firstPlayer)
})

test('守備位置を入れ替えられる', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('start').click()

  const before = await page.getByTestId('slot-SS').innerText()

  await page.getByTestId('position-a').selectOption('SS')
  await page.getByTestId('position-b').selectOption('LF')
  await page.getByTestId('swap-positions').click()

  const after = await page.getByTestId('slot-SS').innerText()
  expect(after).not.toBe(before)
})

test('控えを1番の打席に入れられる', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('start').click()

  const before = await page.getByTestId('lineup').locator('li').first().innerText()
  await page.getByTestId('bench-in-0').click()

  const after = await page.getByTestId('lineup').locator('li').first().innerText()
  expect(after).not.toBe(before)
  expect(await page.getByTestId('lineup').locator('li').count()).toBe(9)
})

test('能力値を編集して保存できる', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('start').click()

  await page.getByTestId('edit-P').click()
  await expect(page.getByTestId('ability-editor')).toBeVisible()

  await page.getByTestId('edit-contact').fill('99')
  await page.getByTestId('edit-power').fill('88')
  await page.getByTestId('edit-name').fill('山田 エース')
  await page.getByTestId('edit-number').fill('18')
  await page.getByTestId('save-player').click()

  await expect(page.getByTestId('notice')).toContainText('山田 エース')

  await page.getByTestId('edit-P').click()
  await expect(page.getByTestId('edit-contact')).toHaveValue('99')
  await expect(page.getByTestId('edit-power')).toHaveValue('88')
  await expect(page.getByTestId('edit-name')).toHaveValue('山田 エース')
  await expect(page.getByTestId('edit-number')).toHaveValue('18')
})

test('能力値を数値入力でも変更できる', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('start').click()
  await page.getByTestId('edit-P').click()

  await page.getByTestId('edit-number-contact').fill('77')
  await expect(page.getByTestId('edit-contact')).toHaveValue('77')

  await page.getByTestId('edit-contact').fill('66')
  await expect(page.getByTestId('edit-number-contact')).toHaveValue('66')

  await page.getByTestId('edit-number-power').fill('150')
  await expect(page.getByTestId('edit-power')).toHaveValue('100')
  await page.getByTestId('save-player').click()

  await page.getByTestId('edit-P').click()
  await expect(page.getByTestId('edit-number-contact')).toHaveValue('66')
  await expect(page.getByTestId('edit-number-power')).toHaveValue('100')
})

test('控え選手を追加・削除できる', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('start').click()

  await expect(page.getByTestId('bench-count')).toHaveText('5/8 人')
  await page.getByTestId('add-bench').click()
  await expect(page.getByTestId('bench-count')).toHaveText('6/8 人')

  await page.getByTestId('add-bench').click()
  await page.getByTestId('add-bench').click()
  await expect(page.getByTestId('bench-count')).toHaveText('8/8 人')
  await expect(page.getByTestId('add-bench')).toBeDisabled()

  await page.getByTestId('bench-remove-0').click()
  await expect(page.getByTestId('bench-count')).toHaveText('7/8 人')
  await expect(page.getByTestId('add-bench')).toBeEnabled()
})

test('能力値の合計がスライダーに追従する', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('start').click()
  await page.getByTestId('edit-1B').click()

  const before = Number(await page.getByTestId('ability-total').innerText())
  await page.getByTestId('edit-contact').fill('100')
  await page.getByTestId('edit-power').fill('100')
  const after = Number(await page.getByTestId('ability-total').innerText())

  expect(after).toBeGreaterThanOrEqual(before)
})

test('試合を開始すると試合画面になる', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('start').click()

  await page.getByTestId('start-game').click()

  await expect(page.getByTestId('inning')).toHaveText('1回 表')
  await expect(page.getByTestId('pitch-controls')).toBeVisible()
  await expect(page.getByTestId('score')).toContainText('0')
})

test('9回終了のスコア表が表示される', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('start').click()
  await page.getByTestId('start-game').click()
  await page.getByTestId('auto-play').click()

  await expect(page.getByTestId('final-score')).toBeVisible()

  const finalAway = await page.getByTestId('final-away').innerText()
  const finalHome = await page.getByTestId('final-home').innerText()

  expect(Number(finalAway)).toBeGreaterThanOrEqual(0)
  expect(Number(finalHome)).toBeGreaterThanOrEqual(0)
  expect(Number.isInteger(Number(finalAway))).toBe(true)

  const headers = page.locator('.linescore thead th')
  expect(await headers.count()).toBe(11) // チーム + 9 回 + 計
})

test('結果画面から編成に戻れる', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('start').click()
  await page.getByTestId('start-game').click()
  await page.getByTestId('auto-play').click()

  await expect(page.getByTestId('final-score')).toBeVisible()
  await page.getByTestId('back-to-team').click()

  await expect(page.getByTestId('lineup')).toBeVisible()
})

test('結果画面から同じチームでもう一度戦える', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('start').click()
  await page.getByTestId('start-game').click()
  await page.getByTestId('auto-play').click()

  await page.getByTestId('rematch').click()
  await expect(page.getByTestId('inning')).toHaveText('1回 表')
  await expect(page.getByTestId('score')).toContainText('0 - 0')
})

test('編成をやり直すと新しい選手が変わる', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('start').click()

  const before = await page.getByTestId('lineup').locator('li').allInnerTexts()
  await page.getByTestId('reroll').click()
  const after = await page.getByTestId('lineup').locator('li').allInnerTexts()

  expect(after).not.toEqual(before)
  expect(after).toHaveLength(9)
})

test('コンソールエラーが発生しない', async ({ page }) => {
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto('/')
  await page.getByTestId('start').click()
  await page.getByTestId('edit-P').click()
  await page.getByTestId('edit-control').fill('77')
  await page.getByTestId('save-player').click()
  await page.getByTestId('start-game').click()
  await page.getByTestId('course-middle-center').click()
  await page.getByTestId('auto-play').click()
  await expect(page.getByTestId('final-score')).toBeVisible()

  expect(errors).toEqual([])
})
