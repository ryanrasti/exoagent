import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      'capnweb-eval': resolve(__dirname, 'packages/capnweb-eval/src'),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'packages/capnweb-eval/**/*.test.ts'],
    // Exclude live tests (API calls) from default test run - run explicitly with: npm test -- src/**/*.live.test.ts
    exclude: ['**/node_modules/**', '**/.direnv/**', '**/*.live.test.ts'],
  },
})
