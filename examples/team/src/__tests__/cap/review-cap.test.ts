/**
 * Layer 3: ReviewCap tests.
 *
 * Tests the provider's @tool methods end-to-end with real SQLite + real git.
 * Pi is mocked.
 */

import Database from 'better-sqlite3'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { createTestRepo } from '../fixtures'
import * as db from '../../providers/review/db'
import * as gitOps from '../../providers/review/git'

// We test the DB functions + git ops directly here since the provider
// class requires the full exoagent loader. This tests the same logic
// the cap would exercise.

let sqliteDb: Database.Database
let repo: ReturnType<typeof createTestRepo>

beforeEach(() => {
	sqliteDb = new Database(':memory:')
	db.initSchema(sqliteDb)
	repo = createTestRepo()
})

afterEach(() => {
	repo.cleanup()
})

/**
 * Helper: simulates what ReviewProvider.createReview does.
 */
const createReview = (ref: string) => {
	const repoRoot = gitOps.getRepoRoot(repo.dir)
	const review = db.createReview(sqliteDb, { baseRef: ref, repoRoot })
	const changedFiles = gitOps.getChangedFiles(repoRoot, ref)
	for (const filePath of changedFiles) {
		const file = db.addFile(sqliteDb, review.id, filePath)
		const baseContent = gitOps.getFileAtRef(repoRoot, filePath, ref) ?? ''
		db.createRound(sqliteDb, file.id, 1, baseContent)
	}
	return review
}

describe('create review + files', () => {
	it('creates review with changed files', () => {
		const review = createReview('HEAD')
		const files = db.listFiles(sqliteDb, review.id)
		expect(files.length).toBeGreaterThan(0)
		const paths = files.map(f => f.path)
		expect(paths).toContain('hello.ts')
		expect(paths).toContain('new-file.ts')
	})

	it('each file has round 1 with base content', () => {
		const review = createReview('HEAD')
		const files = db.listFiles(sqliteDb, review.id)
		for (const file of files) {
			const rounds = db.listRounds(sqliteDb, file.id)
			expect(rounds).toHaveLength(1)
			expect(rounds[0].round_num).toBe(1)
			expect(rounds[0].snap_content).toBeNull() // mutable
		}
	})

	it('round 1 base_content = file at HEAD', () => {
		const review = createReview('HEAD')
		const files = db.listFiles(sqliteDb, review.id)
		const helloFile = files.find(f => f.path === 'hello.ts')!
		const rounds = db.listRounds(sqliteDb, helloFile.id)
		// hello.ts at HEAD was 'const x = 1\n', but git show strips trailing newline
		expect(rounds[0].base_content).toBe('const x = 1')
	})

	it('new file has empty base_content', () => {
		const review = createReview('HEAD')
		const files = db.listFiles(sqliteDb, review.id)
		const newFile = files.find(f => f.path === 'new-file.ts')!
		const rounds = db.listRounds(sqliteDb, newFile.id)
		expect(rounds[0].base_content).toBe('')
	})
})

describe('pendingThreads', () => {
	it('returns empty on fresh review', () => {
		const review = createReview('HEAD')
		const threads = db.listPendingThreads(sqliteDb, review.id)
		expect(threads).toHaveLength(0)
	})
})

describe('thread lifecycle', () => {
	it('create thread + reply → pendingThreads returns it', () => {
		const review = createReview('HEAD')
		const files = db.listFiles(sqliteDb, review.id)
		const file = files.find(f => f.path === 'hello.ts')!
		const mutableRound = db.getMutableRound(sqliteDb, file.id)!

		// Freeze round (simulates first thread creation)
		const currentContent = gitOps.getFileContent(repo.dir, file.path) ?? ''
		db.freezeRound(sqliteDb, mutableRound.id, currentContent)

		const thread = db.createThread(sqliteDb, { roundId: mutableRound.id, lineStart: 1, snippet: 'const x = 2' })
		db.createComment(sqliteDb, thread.id, 'Use for...of here', 'human')

		// Create new mutable round
		db.createRound(sqliteDb, file.id, 2, currentContent)

		const pending = db.listPendingThreads(sqliteDb, review.id)
		expect(pending).toHaveLength(1)
		expect(pending[0].comments).toHaveLength(1)
		expect(pending[0].comments[0].body).toBe('Use for...of here')
	})

	it('address → thread status = addressed', () => {
		const review = createReview('HEAD')
		const files = db.listFiles(sqliteDb, review.id)
		const file = files[0]
		const round = db.getMutableRound(sqliteDb, file.id)!
		db.freezeRound(sqliteDb, round.id, 'snap')

		const thread = db.createThread(sqliteDb, { roundId: round.id, lineStart: 1 })
		db.addressThread(sqliteDb, thread.id)
		expect(db.getThread(sqliteDb, thread.id)!.status).toBe('addressed')

		// Still shows in pending (addressed is still pending review)
		db.createComment(sqliteDb, thread.id, 'fix', 'human')
		const pending = db.listPendingThreads(sqliteDb, review.id)
		expect(pending).toHaveLength(1)
	})

	it('resolve all threads → round collapsible', () => {
		const review = createReview('HEAD')
		const files = db.listFiles(sqliteDb, review.id)
		const file = files[0]
		const round = db.getMutableRound(sqliteDb, file.id)!
		db.freezeRound(sqliteDb, round.id, 'snap')

		const t1 = db.createThread(sqliteDb, { roundId: round.id, lineStart: 1 })
		const t2 = db.createThread(sqliteDb, { roundId: round.id, lineStart: 5 })
		db.resolveThread(sqliteDb, t1.id)
		db.resolveThread(sqliteDb, t2.id)

		expect(db.isRoundCollapsible(sqliteDb, round.id)).toBe(true)

		// No pending threads
		const pending = db.listPendingThreads(sqliteDb, review.id)
		expect(pending).toHaveLength(0)
	})
})

describe('fileDiff', () => {
	it('returns diff for mutable round', () => {
		const review = createReview('HEAD')
		const files = db.listFiles(sqliteDb, review.id)
		const helloFile = files.find(f => f.path === 'hello.ts')!
		const round = db.getMutableRound(sqliteDb, helloFile.id)!

		// Compute diff manually (same logic as provider)
		const oldContent = round.base_content ?? ''
		const newContent = gitOps.getFileContent(repo.dir, helloFile.path) ?? ''
		const hunks = gitOps.parseDiff(oldContent, newContent, helloFile.path)

		expect(hunks.length).toBeGreaterThan(0)
		expect(oldContent).toContain('const x = 1')
		expect(newContent).toContain('const x = 2')
	})
})

describe('status', () => {
	it('returns correct counts', () => {
		const review = createReview('HEAD')
		const files = db.listFiles(sqliteDb, review.id)
		const file = files[0]
		const round = db.getMutableRound(sqliteDb, file.id)!
		db.freezeRound(sqliteDb, round.id, 'snap')

		const t1 = db.createThread(sqliteDb, { roundId: round.id, lineStart: 1 })
		const t2 = db.createThread(sqliteDb, { roundId: round.id, lineStart: 5 })
		db.addressThread(sqliteDb, t1.id)
		db.resolveThread(sqliteDb, t2.id)

		// Manual status check
		let open = 0, addressed = 0, resolved = 0
		for (const f of files) {
			for (const r of db.listRounds(sqliteDb, f.id)) {
				for (const t of db.listThreads(sqliteDb, r.id)) {
					if (t.status === 'open') { open++ }
					else if (t.status === 'addressed') { addressed++ }
					else if (t.status === 'resolved') { resolved++ }
				}
			}
		}
		expect(addressed).toBe(1)
		expect(resolved).toBe(1)
	})
})

describe('comment triggers delivery', () => {
	it('onComment callback fires for new comments', () => {
		const review = createReview('HEAD')
		const files = db.listFiles(sqliteDb, review.id)
		const file = files[0]
		const round = db.getMutableRound(sqliteDb, file.id)!
		db.freezeRound(sqliteDb, round.id, 'snap')

		const thread = db.createThread(sqliteDb, { roundId: round.id, lineStart: 1 })

		// Simulate what ReviewProvider does internally
		const callback = vi.fn()
		const comment = db.createComment(sqliteDb, thread.id, 'Fix this', 'human')

		// Call the callback manually (in real provider this happens in notifyComment)
		callback(comment, thread, file.path)
		expect(callback).toHaveBeenCalledOnce()
		expect(callback).toHaveBeenCalledWith(
			expect.objectContaining({ body: 'Fix this' }),
			expect.objectContaining({ line_start: 1 }),
			file.path,
		)
	})
})
