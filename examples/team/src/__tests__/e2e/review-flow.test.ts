import { test, expect } from '@playwright/test'
import { startTestServer, type TestServer } from './test-server'
import { createTestRepo } from '../fixtures'

let server: TestServer
let repo: ReturnType<typeof createTestRepo>

test.beforeEach(async () => {
	repo = createTestRepo()
	server = await startTestServer(repo.dir)
})

test.afterEach(async () => {
	await server.close()
	repo.cleanup()
})

test('create review → file list shows changed files', async ({ page }) => {
	await page.goto(`http://localhost:${server.port}/`)
	// Should show picker initially (no reviews yet)
	await expect(page.getByTestId('picker')).toBeVisible()
	await expect(page.getByTestId('create-button')).toBeVisible()

	// Create review
	await page.getByTestId('create-button').click()

	// Should transition to review app
	await expect(page.getByTestId('review-app')).toBeVisible()
	await expect(page.getByTestId('file-list')).toBeVisible()

	// Should show changed files
	await expect(page.getByTestId('file-item-hello.ts')).toBeVisible()
	await expect(page.getByTestId('file-item-new-file.ts')).toBeVisible()
})

test('click file → see diff pane', async ({ page }) => {
	await page.goto(`http://localhost:${server.port}/`)
	await page.getByTestId('create-button').click()
	await expect(page.getByTestId('review-app')).toBeVisible()

	// Click a file
	await page.getByTestId('file-item-hello.ts').click()

	// Should show diff pane
	await expect(page.getByTestId('diff-pane')).toBeVisible()
})
