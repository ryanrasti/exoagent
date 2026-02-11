import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: 'renderer',
  base: './',
  publicDir: 'public',
  build: {
    outDir: '../dist/renderer',
    emptyOutDir: true,
  },
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/rpc': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
