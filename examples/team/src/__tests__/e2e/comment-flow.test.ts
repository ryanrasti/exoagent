import { test, expect } from '@playwright/test'
import { startTestServer, type TestServer } from './test-server'
import { createTestRepo } from '../fixtures'
import * as db from '../../providers/review/db'

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

test('add comment via agent API → appears in thread sidebar', async ({ page }) => {
	await page.goto(`http://localhost:${server.port}/`)
	await page.getByTestId('create-button').click()
	await expect(page.getByTestId('review-app')).toBeVisible()

	// Create a thread via the API (simulating agent)
	const reviews = db.listReviews(server.db)
	const files = db.listFiles(server.db, reviews[0].id)
	const helloFile = files.find(f => f.path === 'hello.ts')!
	const round = db.getMutableRound(server.db, helloFile.id)!

	// Freeze round + create thread
	db.freezeRound(server.db, round.id, 'const x = 2\nconst y = 3\n')
	const thread = db.createThread(server.db, { roundId: round.id, lineStart: 1 })
	db.createComment(server.db, thread.id, 'Use for...of here', 'human')
	db.createRound(server.db, helloFile.id, 2, 'const x = 2\nconst y = 3\n')

	// Click file to see the thread
	await page.getByTestId('file-item-hello.ts').click()

	// Thread sidebar should show
	await expect(page.getByTestId('thread-sidebar')).toBeVisible()
	await expect(page.getByTestId(`thread-view-${thread.id}`)).toBeVisible()
	await expect(page.getByText('Use for...of here')).toBeVisible()
})

test('agent addresses thread → status updates', async ({ page }) => {
	await page.goto(`http://localhost:${server.port}/`)
	await page.getByTestId('create-button').click()
	await expect(page.getByTestId('review-app')).toBeVisible()

	// Set up thread
	const reviews = db.listReviews(server.db)
	const files = db.listFiles(server.db, reviews[0].id)
	const file = files.find(f => f.path === 'hello.ts')!
	const round = db.getMutableRound(server.db, file.id)!
	db.freezeRound(server.db, round.id, 'snap')
	const thread = db.createThread(server.db, { roundId: round.id, lineStart: 1 })
	db.createComment(server.db, thread.id, 'Fix this', 'human')
	db.createRound(server.db, file.id, 2, 'snap')

	// Agent addresses
	db.addressThread(server.db, thread.id)

	// View the file
	await page.getByTestId('file-item-hello.ts').click()
	await expect(page.getByTestId(`thread-status-addressed`)).toBeVisible()
})

test('resolve thread → status shows resolved', async ({ page }) => {
	await page.goto(`http://localhost:${server.port}/`)
	await page.getByTestId('create-button').click()
	await expect(page.getByTestId('review-app')).toBeVisible()

	// Set up thread
	const reviews = db.listReviews(server.db)
	const files = db.listFiles(server.db, reviews[0].id)
	const file = files.find(f => f.path === 'hello.ts')!
	const round = db.getMutableRound(server.db, file.id)!
	db.freezeRound(server.db, round.id, 'snap')
	const thread = db.createThread(server.db, { roundId: round.id, lineStart: 1 })
	db.createComment(server.db, thread.id, 'Fix', 'human')
	db.createRound(server.db, file.id, 2, 'snap')

	// Click file, then resolve via button
	await page.getByTestId('file-item-hello.ts').click()
	await expect(page.getByTestId(`resolve-button-${thread.id}`)).toBeVisible()
	await page.getByTestId(`resolve-button-${thread.id}`).click()

	// Status should update — re-click file to refresh
	await page.getByTestId('file-item-hello.ts').click()
	// After resolve, thread should show resolved status or be gone from open list
	const resolvedThread = db.getThread(server.db, thread.id)
	expect(resolvedThread?.status).toBe('resolved')
	expect(resolvedThread?.resolved_at).not.toBeNull()
})
