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

test('defer thread → moves to next round, original_round_id preserved', async ({ page }) => {
	await page.goto(`http://localhost:${server.port}/`)
	await page.getByTestId('create-button').click()
	await expect(page.getByTestId('review-app')).toBeVisible()

	// Set up thread on round 1
	const reviews = db.listReviews(server.db)
	const files = db.listFiles(server.db, reviews[0].id)
	const file = files.find(f => f.path === 'hello.ts')!
	const round1 = db.getMutableRound(server.db, file.id)!
	db.freezeRound(server.db, round1.id, 'snap1')
	const thread = db.createThread(server.db, { roundId: round1.id, lineStart: 5 })
	db.createComment(server.db, thread.id, 'Needs refactor', 'human')
	const round2 = db.createRound(server.db, file.id, 2, 'snap1')

	// Click file to see thread
	await page.getByTestId('file-item-hello.ts').click()
	await expect(page.getByTestId(`defer-button-${thread.id}`)).toBeVisible()

	// Click defer
	await page.getByTestId(`defer-button-${thread.id}`).click()

	// Verify in DB: thread moved to round 2, original preserved
	const movedThread = db.getThread(server.db, thread.id)!
	expect(movedThread.round_id).toBe(round2.id)
	expect(movedThread.original_round_id).toBe(round1.id)
	expect(movedThread.status).toBe('open')

	// Round 1 should now be collapsible
	expect(db.isRoundCollapsible(server.db, round1.id)).toBe(true)
})
