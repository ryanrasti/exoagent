import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
		exclude: ['src/__tests__/e2e/**'],
		environment: 'node',
	},
})
