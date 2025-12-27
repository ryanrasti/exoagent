import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/code-mode-runtime.ts'],
  format: ['esm'],
  dts: false,
  clean: false,
  outDir: 'dist',
  unbundle: false,
  noExternal: ['capnweb'],
  minify: false,
  sourcemap: false,
})
