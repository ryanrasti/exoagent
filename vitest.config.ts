import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		exclude: ['src/ui/**'],
	},
	// Prevent vitest from inheriting vite.config.ts React plugin
	// which breaks decorator transforms
	plugins: [],
})
