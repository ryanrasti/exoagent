import { defineConfig } from '@playwright/test'

export default defineConfig({
	testDir: 'src/__tests__/e2e',
	timeout: 30_000,
	retries: 0,
	use: {
		headless: true,
	},
	// No webServer — each test starts its own server via test-server.ts
})
