import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
	root: resolve(__dirname, 'src/ui'),
	plugins: [react()],
	build: {
		rollupOptions: {
			input: {
				dashboard: resolve(__dirname, 'src/ui/dashboard/index.html'),
				github: resolve(__dirname, 'src/ui/github/index.html'),
			},
		},
		outDir: resolve(__dirname, 'dist/ui'),
		emptyOutDir: true,
	},
	server: {
		proxy: {
			'/api': 'http://localhost:3000',
		},
	},
})
