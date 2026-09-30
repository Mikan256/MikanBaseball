import { expect, test } from '@playwright/test'

/**
 * 1 試合を最後まで投球させる。
 * 実測で 1 試合あたり 400〜900 球になるので、ブラウザ内で連続クリックする。
 * 1 球ずつ Playwright のクリックを待つと数十秒かかるため page.evaluate 内で流す。
 */
async function playUntilGameOver(page, pitchId = 'slider', maxPitches = 1200) {
  return page.evaluate(
    ({ pitchId: id, limit }) => {
      const button = () => document.querySelector(`[data-pitch="${id}"]`)
      const isOver = () => document.querySelector('[data-testid="gameover"]') !== null

      let thrown = 0
      while (!isOver() && thrown < limit) {
        const target = button()
        if (!target) break
        target.click()
        thrown += 1
      }
      return { thrown, finished: isOver() }
    },
    { pitchId, limit: maxPitches },
  )
}

test('タイトル画面が表示され、ゲーム開始できる', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'みかん野球' })).toBeVisible()

  await page.getByTestId('start').click()

  await expect(page.getByTestId('inning')).toHaveText('1回 表')
  await expect(page.getByTestId('pitch-straight')).toBeVisible()
})

test('スコアボードに両チーム名と 0-0 が表示される', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('start').click()

  await expect(
    page.getByRole('heading', { name: 'オーシャンホークス vs マンダリンタイガース' }),
  ).toBeVisible()
  await expect(page.getByTestId('score-away')).toHaveText('0')
  await expect(page.getByTestId('score-home')).toHaveText('0')
})

test('球種を選ぶと結果が出てログに記録される', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('start').click()

  await page.getByTestId('pitch-curve').click()

  await expect(page.getByTestId('log').locator('li')).toHaveCount(1)
  await expect(page.getByTestId('result')).toContainText('カーブ')
})

test('投球するとカウント（球数）が変わる', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('start').click()

  await page.getByTestId('pitch-straight').click()

  const balls = Number(await page.getByTestId('balls').textContent())
  const strikes = Number(await page.getByTestId('strikes').textContent())
  const outs = Number(await page.getByTestId('outs').textContent())

  expect(balls + strikes + outs).toBeGreaterThan(0)
})

test('アウトを3つ重ねると表裏が入れ替わる', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('start').click()

  // 投球結果に依存しないよう、表が終わるまで投球を続ける（最大 60 球）
  for (let i = 0; i < 60; i += 1) {
    const inning = await page.getByTestId('inning').textContent()
    if (inning !== '1回 表') break
    await page.getByTestId('pitch-straight').click()
  }

  await expect(page.getByTestId('inning')).toHaveText('1回 裏')
})

test('9回が終わるとゲームオーバーが表示される', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('start').click()

  const result = await playUntilGameOver(page)

  expect(result.finished).toBe(true)
  await expect(page.getByTestId('gameover')).toBeVisible()
  await expect(page.getByTestId('restart')).toBeVisible()
})

test('ゲームオーバー後にリスタートできる', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('start').click()

  const result = await playUntilGameOver(page)

  expect(result.finished).toBe(true)
  await expect(page.getByTestId('gameover')).toBeVisible()

  await page.getByTestId('restart').click()

  await expect(page.getByTestId('inning')).toHaveText('1回 表')
  await expect(page.getByTestId('score-away')).toHaveText('0')
})

test('コンソールエラーが発生しない', async ({ page }) => {
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto('/')
  await page.getByTestId('start').click()
  await page.getByTestId('pitch-straight').click()
  await page.getByTestId('pitch-curve').click()

  expect(errors).toEqual([])
})
