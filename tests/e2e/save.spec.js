import { expect, test } from '@playwright/test'
import { throwPitch } from './helpers.js'

test('試合の途中経過を保存して再開できる', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('start').click()
  await page.getByTestId('start-game').click()
  await throwPitch(page, 'middle-center')

  const pitchCount = await page.getByTestId('game-screen').getAttribute('data-pitch-count')
  expect(Number(pitchCount)).toBe(1)

  await page.reload()

  await expect(page.getByTestId('resume-game')).toBeVisible()
  await expect(page.getByTestId('saved-game-info')).toContainText('1回表')

  await page.getByTestId('resume-game').click()

  await expect(page.getByTestId('game-screen')).toBeVisible()
  await expect(page.getByTestId('game-screen')).toHaveAttribute('data-pitch-count', pitchCount)
  await expect(page.getByTestId('match-canvas')).toBeVisible()
})

test('保存データを削除できる', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('start').click()
  await page.getByTestId('start-game').click()
  await throwPitch(page, 'high-center')

  await page.reload()
  await expect(page.getByTestId('delete-save')).toBeVisible()
  await page.getByTestId('delete-save').click()

  await expect(page.getByTestId('resume-game')).toHaveCount(0)
  await expect(page.getByTestId('start')).toBeVisible()
})
