import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/rpc-toolset-test-helpers.ts'],
  dts: true,
  format: ['esm'],
  treeshake: true,
  clean: false,
  publint: false,
})
