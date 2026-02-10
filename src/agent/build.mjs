import * as esbuild from 'esbuild'

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron', 'better-sqlite3'],
}

await Promise.all([
  esbuild.build({
    ...common,
    entryPoints: ['main/index.ts'],
    outfile: 'dist/main/index.cjs',
  }),
  esbuild.build({
    ...common,
    entryPoints: ['preload/index.ts'],
    outfile: 'dist/preload/index.cjs',
  }),
])

console.log('Electron main/preload built successfully')
