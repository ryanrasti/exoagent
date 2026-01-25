import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { externalizeDeps } from 'vite-plugin-externalize-deps'

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        sql: resolve(__dirname, 'src/sql.ts'),
      },
      formats: ['es'],
      fileName: (_, entryName) => `${entryName}.mjs`,
    },
    target: 'es2022',
    minify: false,
  },
  plugins: [
    externalizeDeps(),
    dts({
      rollupTypes: false,
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'test/**/*', 'packages/**/*'],
      entryRoot: 'src',
    }),
  ],
})
