import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['viz/**/*.test.ts'],
  },
})
