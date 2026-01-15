import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      capnweb: path.resolve(__dirname, 'packages/capnweb/src/index.ts'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    server: {
      deps: {
        inline: ['vitest-package-exports'],
      },
    },
  },
})
