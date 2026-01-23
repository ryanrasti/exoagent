import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    'src/index.ts',
  ],
  dts: true,
  exports: true,
  publint: true,
  noExternal: ['capnweb'],
  // Target ES2022 to transform decorators (TC39 stage 3)
  // Without this, decorators are left as-is and fail in runtimes that don't support them
  target: 'es2022',
})
