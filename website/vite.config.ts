import type { Plugin } from 'vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react-swc'
import { transform } from 'esbuild'
import { defineConfig } from 'vite'

// Transform decorators before SWC sees them
function esbuildDecorators(): Plugin {
  return {
    name: 'esbuild-decorators',
    enforce: 'pre',
    async transform(code, id) {
      if (!id.endsWith('.ts') && !id.endsWith('.tsx'))
        return
      if (!code.includes('@'))
        return
      const result = await transform(code, {
        loader: id.endsWith('.tsx') ? 'tsx' : 'ts',
        target: 'es2022',
        sourcemap: true,
        sourcefile: id,
      })
      return { code: result.code, map: result.map }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    esbuildDecorators(),
    react(),
    tailwindcss(),
    cloudflare({
      configPath: './wrangler.jsonc',
    }),
  ],
  optimizeDeps: {
    exclude: ['@electric-sql/pglite'],
  },
  server: {
    fs: {
      // Allow serving files from parent node_modules (for pglite wasm/data files)
      allow: ['..'],
    },
  },
})
