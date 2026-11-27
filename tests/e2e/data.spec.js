import { expect, test } from '@playwright/test'
import { throwPitch } from './helpers.js'

async function openTeam(page) {
  await page.goto('/')
  await page.getByTestId('start').click()
  await expect(page.getByRole('heading', { name: 'チーム編成' })).toBeVisible()
}

/** ページ全体のスクロール量とビューポートの大きさを取得する */
async function viewportMetrics(page) {
  return page.evaluate(() => ({
    scrollWidth: document.scrollingElement.scrollWidth,
    scrollHeight: document.scrollingElement.scrollHeight,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  }))
}

/**
 * ページがビューポートからはみ出していないことを確認する。
 * 横方向は常に、vertical を指定したときは縦方向も確認する。
 */
async function expectNoPageOverflow(page, { vertical = false } = {}) {
  const sizes = await viewportMetrics(page)
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.innerWidth + 1)
  if (vertical) {
    expect(sizes.scrollHeight).toBeLessThanOrEqual(sizes.innerHeight + 1)
  }
}

/** 指定した要素がビューポート内に完全に収まっていることを確認する */
async function expectInsideViewport(page, testId) {
  const box = await page.getByTestId(testId).boundingBox()
  expect(box).not.toBeNull()
  const innerHeight = await page.evaluate(() => window.innerHeight)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(innerHeight + 1)
}

/** 表示中の操作パネル（投球／打席）の主要ボタンが画面内に収まっていることを確認する */
async function expectMatchControlsInsideViewport(page) {
  if (await page.getByTestId('pitch-controls').isVisible()) {
    await expectInsideViewport(page, 'release-pitch')
    await expectInsideViewport(page, 'course-low-out')
    return
  }
  await expect(page.getByTestId('bat-controls')).toBeVisible()
  await expectInsideViewport(page, 'swing-contact')
  await expectInsideViewport(page, 'take')
}

test('チーム名を変更でき、試合画面にも反映される', async ({ page }) => {
  await openTeam(page)

  await page.getByTestId('team-name-input').fill('テストドラゴンズ')
  await page.getByTestId('rename-team').click()

  await expect(page.getByTestId('notice')).toContainText('テストドラゴンズ')
  await expect(page.getByTestId('team-name-input')).toHaveValue('テストドラゴンズ')

  await page.getByTestId('start-game').click()
  await expect(page.getByTestId('score')).toContainText('テストドラゴンズ')
})

test('Enter キーでもチーム名を変更できる', async ({ page }) => {
  await openTeam(page)

  await page.getByTestId('team-name-input').fill('エンター球団')
  await page.getByTestId('team-name-input').press('Enter')

  await expect(page.getByTestId('notice')).toContainText('エンター球団')
  await expect(page.getByTestId('team-name-input')).toHaveValue('エンター球団')
})

test('書き出した文字列をコピーして読み込むと編成が復元される', async ({ page }) => {
  await openTeam(page)

  await page.getByTestId('team-name-input').fill('データテスト')
  await page.getByTestId('rename-team').click()
  await page.getByTestId('edit-SS').click()
  await page.getByTestId('edit-name').fill('保存 太郎')
  await page.getByTestId('edit-contact').fill('93')
  await page.getByTestId('save-player').click()

  await page.getByTestId('data-summary').click()
  const code = await page.getByTestId('team-code').inputValue()
  expect(code).toContain('データテスト')
  expect(code).toContain('保存 太郎')

  await page.getByTestId('reroll').click()
  await page.getByTestId('data-summary').click()
  await page.getByTestId('import-code').fill(code)
  await page.getByTestId('import-team-code').click()

  await expect(page.getByTestId('notice')).toContainText('データテスト')
  await expect(page.getByTestId('team-name-input')).toHaveValue('データテスト')

  await page.getByTestId('edit-SS').click()
  await expect(page.getByTestId('edit-name')).toHaveValue('保存 太郎')
  await expect(page.getByTestId('edit-contact')).toHaveValue('93')
})

test('ファイルからも編成を読み込める', async ({ page }) => {
  await openTeam(page)
  await page.getByTestId('team-name-input').fill('ファイル球団')
  await page.getByTestId('rename-team').click()

  await page.getByTestId('data-summary').click()
  const code = await page.getByTestId('team-code').inputValue()

  await page.getByTestId('reroll').click()
  await page.getByTestId('data-summary').click()
  await page.getByTestId('team-code-file').setInputFiles({
    name: 'team.json',
    mimeType: 'application/json',
    buffer: Buffer.from(code, 'utf8'),
  })

  await expect(page.getByTestId('notice')).toContainText('ファイル球団')
  await expect(page.getByTestId('team-name-input')).toHaveValue('ファイル球団')
})

test('コピーとファイル保存ができる', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await openTeam(page)
  await page.getByTestId('data-summary').click()

  await page.getByTestId('copy-team-code').click()
  await expect(page.getByTestId('notice')).toContainText('コピーしました')
  const clipboard = await page.evaluate(() => navigator.clipboard.readText())
  expect(clipboard).toContain('"format"')

  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('download-team-code').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toContain('.json')
})

test('壊れた文字列は読み込まずにエラーを表示する', async ({ page }) => {
  await openTeam(page)
  await page.getByTestId('data-summary').click()

  await page.getByTestId('import-code').fill('壊れたデータ')
  await page.getByTestId('import-team-code').click()

  await expect(page.getByTestId('notice')).toContainText('読み込めません')
  await expect(page.getByTestId('import-code')).toHaveValue('壊れたデータ')
})

test('スマホ横画面でも横スクロールせずに編成・試合・結果を操作できる', async ({ page }) => {
  await page.setViewportSize({ width: 812, height: 375 })
  await openTeam(page)

  await expectNoPageOverflow(page)
  await page.getByTestId('edit-1B').click()
  await expect(page.getByTestId('ability-editor')).toBeVisible()
  await expectNoPageOverflow(page)
  await page.getByTestId('cancel-edit').click()

  await page.getByTestId('start-game').click()
  await expectNoPageOverflow(page)

  // 試合画面では縦にもスクロールせず、操作ボタンが画面内に収まる
  await expect(page.getByTestId('game-screen')).toBeVisible()
  await expectNoPageOverflow(page, { vertical: true })
  await expectMatchControlsInsideViewport(page)

  await throwPitch(page, 'high-out')
  await expect(page.getByTestId('last-result')).toBeVisible()
  await expectNoPageOverflow(page, { vertical: true })
  await expectMatchControlsInsideViewport(page)

  await page.getByTestId('auto-play').click()
  await expect(page.getByTestId('final-score')).toBeVisible()
  await expectNoPageOverflow(page)
})

test('スマホ横画面(667x375)でも試合画面が縦スクロールしない', async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 })
  await openTeam(page)
  await page.getByTestId('start-game').click()

  await expect(page.getByTestId('game-screen')).toBeVisible()
  await expectNoPageOverflow(page, { vertical: true })
  await expectMatchControlsInsideViewport(page)

  await throwPitch(page, 'high-out')
  await expect(page.getByTestId('last-result')).toBeVisible()
  await expectNoPageOverflow(page, { vertical: true })
  await expectMatchControlsInsideViewport(page)
})

test('小型スマホ横画面(568x320)でも試合画面が縦スクロールしない', async ({ page }) => {
  await page.setViewportSize({ width: 568, height: 320 })
  await openTeam(page)
  await page.getByTestId('start-game').click()

  await expect(page.getByTestId('game-screen')).toBeVisible()
  await expectNoPageOverflow(page, { vertical: true })
  await expectMatchControlsInsideViewport(page)

  await throwPitch(page, 'high-out')
  await expect(page.getByTestId('last-result')).toBeVisible()
  await expectNoPageOverflow(page, { vertical: true })
  await expectMatchControlsInsideViewport(page)
})

test('縦画面では横画面を促すオーバーレイが表示される', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await openTeam(page)
  await page.getByTestId('start-game').click()

  await expect(page.getByTestId('rotate-overlay')).toBeVisible()
  await expect(page.getByTestId('rotate-overlay')).toContainText('横画面')
})
