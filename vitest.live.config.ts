import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * Config for live tests that make real API calls.
 * Run with: npm run test:live -- src/agent/mock/evals.live.test.ts
 */
export default defineConfig({
  resolve: {
    alias: {
      'capnweb-eval': resolve(__dirname, 'packages/capnweb-eval/src'),
    },
  },
  test: {
    include: ['src/**/*.live.test.ts'],
    exclude: ['**/node_modules/**', '**/.direnv/**'],
  },
})
