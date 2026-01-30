import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

export default defineConfig({
  build: {
    lib: {
      entry: { index: resolve(__dirname, 'src/index.ts') },
      formats: ['es'],
      fileName: (_, name) => `${name}.mjs`,
    },
    outDir: 'dist',
    target: 'es2022',
    minify: false,
    rollupOptions: {
      external: ['capnweb'],
    },
  },
  plugins: [
    dts({
      rollupTypes: false,
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      entryRoot: 'src',
    }),
  ],
})
