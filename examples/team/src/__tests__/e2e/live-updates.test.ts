import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { startTestServer, type TestServer } from './test-server'
import { createTestRepo } from '../fixtures'
import * as git from '../../providers/review/git'

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

test('modify file on disk → diff updates on next load', async ({ page }) => {
	await page.goto(`http://localhost:${server.port}/`)
	await page.getByTestId('create-button').click()
	await expect(page.getByTestId('review-app')).toBeVisible()

	// Click hello.ts to see diff
	await page.getByTestId('file-item-hello.ts').click()
	await expect(page.getByTestId('diff-pane')).toBeVisible()

	// Modify file on disk
	const repoRoot = git.getRepoRoot(repo.dir)
	writeFileSync(join(repoRoot, 'hello.ts'), 'const x = 999\nconst y = 888\nconst z = 777\n')

	// Re-click file to refresh (triggers new RPC call)
	await page.getByTestId('file-item-new-file.ts').click()
	await page.getByTestId('file-item-hello.ts').click()

	// New content should be reflected in diff
	await expect(page.getByText('999')).toBeVisible()
})
