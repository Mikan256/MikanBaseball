import { expect, test } from '@playwright/test'

test('オンライン対戦ロビーを開ける', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('start').click()

  await expect(page.getByTestId('mode-online')).toBeVisible()
  await page.getByTestId('mode-online').click()

  await expect(page.getByRole('heading', { name: 'オンライン対戦' })).toBeVisible()
  await expect(page.getByTestId('online-status')).toBeVisible()

  await page.getByTestId('online-back').click()
  await expect(page.getByTestId('lineup')).toBeVisible()
})

test('ローカル環境ではオンライン対戦が利用できない旨を表示する', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('start').click()
  await page.getByTestId('mode-online').click()

  await expect(page.getByTestId('online-unavailable')).toContainText('Flaxia Arcade')
  await expect(page.getByTestId('online-create')).toBeDisabled()
  await expect(page.getByTestId('online-join')).toBeDisabled()
})
