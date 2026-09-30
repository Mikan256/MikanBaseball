import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // E2E は Playwright が実行するため、Vitest からは除外する
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
    globals: false,
    restoreMocks: true,
  },
})
