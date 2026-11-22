import { expect, test } from '@playwright/test'
import { throwPitch } from './helpers.js'

async function openTeam(page) {
  await page.goto('/')
  await page.getByTestId('start').click()
  await expect(page.getByRole('heading', { name: 'チーム編成' })).toBeVisible()
}

test('対戦相手チームの名前と選手を編集できる', async ({ page }) => {
  await openTeam(page)

  await page.getByTestId('edit-team-away').click()
  await page.getByTestId('team-name-input').fill('編集アウェイズ')
  await page.getByTestId('rename-team').click()
  await expect(page.getByTestId('notice')).toContainText('編集アウェイズ')

  await page.getByTestId('edit-P').click()
  await page.getByTestId('edit-name').fill('相手 エース')
  await page.getByTestId('edit-control').fill('99')
  await page.getByTestId('save-player').click()

  await expect(page.getByTestId('slot-name-P')).toContainText('相手 エース')

  await page.getByTestId('edit-team-home').click()
  await expect(page.getByTestId('preview-lineup')).toContainText('相手 エース')

  await page.getByTestId('start-game').click()
  await expect(page.getByTestId('score')).toContainText('編集アウェイズ')
})

test('2人プレイでは投球側と打席側を交互に操作できる', async ({ page }) => {
  await openTeam(page)

  await page.getByTestId('mode-two-player').click()
  await expect(page.getByTestId('mode-hint')).toContainText('2人プレイ')
  await page.getByTestId('start-game').click()

  const screen = page.getByTestId('game-screen')
  await expect(screen).toHaveAttribute('data-mode', 'two-player')
  await expect(screen).toHaveAttribute('data-phase', 'pitch')
  await expect(page.getByTestId('turn')).toContainText('プレイヤー1')
  await expect(page.getByTestId('turn')).toContainText('守備')
  await expect(page.getByTestId('pitch-controls')).toBeVisible()

  await throwPitch(page, 'high-out')

  await expect(screen).toHaveAttribute('data-phase', 'bat')
  await expect(screen).toHaveAttribute('data-turn-side', 'away')
  await expect(page.getByTestId('turn')).toContainText('プレイヤー2')
  await expect(page.getByTestId('turn')).toContainText('攻撃')
  await expect(page.getByTestId('incoming-pitch')).not.toBeEmpty()
  await expect(page.getByTestId('bat-controls')).toBeVisible()

  await page.getByTestId('swing-contact').click()

  await expect(screen).toHaveAttribute('data-phase', 'pitch')
  await expect(screen).toHaveAttribute('data-turn-side', 'home')
  await expect(page.getByTestId('game-log').locator('li')).toHaveCount(1)
  await expect(page.getByTestId('pitch-controls')).toBeVisible()
})

test('2人プレイでも最後まで自動進行できる', async ({ page }) => {
  await openTeam(page)
  await page.getByTestId('mode-two-player').click()
  await page.getByTestId('start-game').click()
  await page.getByTestId('auto-play').click()

  await expect(page.getByTestId('final-score')).toBeVisible()
  await expect(page.getByTestId('rematch')).toBeVisible()
})

test('両チームのデータを文字列で保存して復元できる', async ({ page }) => {
  await openTeam(page)

  await page.getByTestId('team-name-input').fill('ホーム編集')
  await page.getByTestId('rename-team').click()
  await page.getByTestId('edit-team-away').click()
  await page.getByTestId('team-name-input').fill('アウェイ編集')
  await page.getByTestId('rename-team').click()

  await page.getByTestId('data-summary').click()
  const code = await page.getByTestId('team-code').inputValue()
  expect(code).toContain('ホーム編集')
  expect(code).toContain('アウェイ編集')
  expect(code).toContain('mikanbaseball-match')

  await page.getByTestId('reroll').click()
  await page.getByTestId('data-summary').click()
  await page.getByTestId('import-code').fill(code)
  await page.getByTestId('import-team-code').click()

  await expect(page.getByTestId('notice')).toContainText('ホーム編集')
  await expect(page.getByTestId('notice')).toContainText('アウェイ編集')
  await expect(page.getByTestId('team-name-input')).toHaveValue('ホーム編集')

  await page.getByTestId('edit-team-away').click()
  await expect(page.getByTestId('team-name-input')).toHaveValue('アウェイ編集')
})

test('スマホ横画面の2人プレイでも横スクロールせず操作できる', async ({ page }) => {
  await page.setViewportSize({ width: 812, height: 375 })
  await openTeam(page)
  await page.getByTestId('mode-two-player').click()

  const noOverflow = async () => {
    const sizes = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }))
    expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.innerWidth + 1)
  }

  await noOverflow()
  await page.getByTestId('start-game').click()
  await noOverflow()
  await throwPitch(page, 'high-out')
  await expect(page.getByTestId('bat-controls')).toBeVisible()
  await noOverflow()
  await page.getByTestId('swing-contact').click()
  await expect(page.getByTestId('pitch-controls')).toBeVisible()
  await noOverflow()
})
