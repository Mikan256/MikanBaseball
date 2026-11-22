import { expect } from '@playwright/test'

/**
 * コースを選び、パワーメーターをリリースして 1 球投げる。
 * コースクリックだけでは投球が確定しないため、E2E ではこのヘルパを使う。
 */
export async function throwPitch(page, courseId = 'middle-center') {
  await page.getByTestId(`course-${courseId}`).click()
  await expect(page.getByTestId('release-pitch')).toBeEnabled()
  await page.getByTestId('release-pitch').click()
}

/** 表の攻撃が終わって自分の打席になるまで投げる */
export async function pitchUntilBatting(page, maxPitches = 240) {
  const courses = ['high-out', 'high-center', 'low-out', 'middle-out', 'middle-center', 'low-in']
  for (let index = 0; index < maxPitches; index += 1) {
    if (await page.getByTestId('bat-controls').count()) return
    await throwPitch(page, courses[index % courses.length])
  }
  throw new Error('打席まで到達しませんでした')
}
