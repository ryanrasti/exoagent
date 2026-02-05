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

  },
})
