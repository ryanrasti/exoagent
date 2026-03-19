import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'packages/**/*.test.ts'],
    exclude: ['**/.direnv/**', '**/node_modules/**', 'src/runtime/exos/typecheck.test.ts'],
  },
})
