import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
	root: resolve(__dirname, 'src/ui'),
	plugins: [react()],
	build: {
		rollupOptions: {
			input: {
				'provider-mount': resolve(__dirname, 'src/ui/provider-mount.tsx'),
				dashboard: resolve(__dirname, 'src/ui/dashboard/Dashboard.tsx'),
			},
		},
		outDir: resolve(__dirname, 'dist/ui'),
		emptyOutDir: true,
	},
	server: {
		// In dev, Vite serves the UI files and the daemon serves HTML templates
		// that point to Vite's dev server for JS
		port: 5173,
	},
})
