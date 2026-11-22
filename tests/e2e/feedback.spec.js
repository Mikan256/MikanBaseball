import { expect, test } from '@playwright/test'
import { throwPitch } from './helpers.js'

async function openTeam(page) {
  await page.goto('/')
  await page.getByTestId('start').click()
}

test('左打者では内角・外角の表示が入れ替わる', async ({ page }) => {
  await openTeam(page)

  // アウェイ（表の攻撃）の 1 番打者を左打者にする
  await page.getByTestId('edit-team-away').click()
  const firstPosition = await page
    .getByTestId('lineup')
    .locator('li')
    .first()
    .getAttribute('data-position')
  await page.getByTestId(`edit-${firstPosition}`).click()
  await page.getByTestId('edit-bats').selectOption('left')
  await page.getByTestId('save-player').click()

  await page.getByTestId('start-game').click()

  await expect(page.getByTestId('turn')).toContainText('あなたの守備')
  await expect(page.getByTestId('course-middle-in')).toHaveText('真ん中外角')
  await expect(page.getByTestId('course-middle-out')).toHaveText('真ん中内角')
  await expect(page.getByTestId('course-high-in')).toHaveText('高め外角')
  await expect(page.getByTestId('course-high-out')).toHaveText('高め内角')
})

test('安打のログに打球方向が表示される', async ({ page }) => {
  await openTeam(page)
  await page.getByTestId('start-game').click()

  let hitText = ''
  for (let index = 0; index < 240; index += 1) {
    if (await page.getByTestId('final-score').count()) break

    if (await page.getByTestId('pitch-controls').count()) {
      await throwPitch(page, 'middle-center')
    } else if (await page.getByTestId('bat-controls').count()) {
      await page.getByTestId('swing-contact').click()
    } else {
      break
    }

    const text = await page.getByTestId('last-result').innerText()
    if (/安打|二塁打|三塁打|ホームラン/.test(text)) {
      hitText = text
      break
    }
  }

  expect(hitText).not.toBe('')
  expect(hitText).toMatch(/レフト|センター|ライト|左中間|一塁|二塁|三塁|遊撃/)
})
