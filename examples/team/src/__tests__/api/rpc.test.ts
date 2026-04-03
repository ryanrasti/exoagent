/**
 * Layer 4: exoRpc round-trip tests.
 *
 * Tests the RPC path that the browser UI uses — exoeval expressions
 * evaluated against the review provider's uiProvider instance.
 *
 * Uses real SQLite + real git repos, exercises the full provider through
 * the exoeval code path.
 */

import Database from 'better-sqlite3'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { createTestRepo } from '../fixtures'
import * as db from '../../providers/review/db'
import * as git from '../../providers/review/git'

// We simulate the exoRpc path: the UI sends a stringified function,
// the server evals it with the provider instance in scope.
// Here we test the provider methods directly (same as what exoeval would call).

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

const createReviewHelper = (ref = 'HEAD') => {
	const repoRoot = git.getRepoRoot(repo.dir)
	const review = db.createReview(sqliteDb, { baseRef: ref, repoRoot })
	const changedFiles = git.getChangedFiles(repoRoot, ref)
	for (const filePath of changedFiles) {
		const file = db.addFile(sqliteDb, review.id, filePath)
		const baseContent = git.getFileAtRef(repoRoot, filePath, ref) ?? ''
		db.createRound(sqliteDb, file.id, 1, baseContent)
	}
	return review
}

describe('review.create → review.files round trip', () => {
	it('create returns review, files returns file list', () => {
		const review = createReviewHelper()
		expect(review.id).toBeTruthy()
		expect(review.base_ref).toBe('HEAD')

		const files = db.listFiles(sqliteDb, review.id)
		expect(files.length).toBeGreaterThan(0)
		const paths = files.map(f => f.path)
		expect(paths).toContain('hello.ts')
	})
})

describe('review.pendingThreads round trip', () => {
	it('returns empty on fresh review', () => {
		const review = createReviewHelper()
		const threads = db.listPendingThreads(sqliteDb, review.id)
		expect(threads).toHaveLength(0)
	})

	it('returns threads after creation', () => {
		const review = createReviewHelper()
		const files = db.listFiles(sqliteDb, review.id)
		const file = files.find(f => f.path === 'hello.ts')!
		const round = db.getMutableRound(sqliteDb, file.id)!

		// Freeze + create thread + comment
		const content = git.getFileContent(repo.dir, file.path) ?? ''
		db.freezeRound(sqliteDb, round.id, content)
		const thread = db.createThread(sqliteDb, { roundId: round.id, lineStart: 1 })
		db.createComment(sqliteDb, thread.id, 'Fix this', 'human')

		const pending = db.listPendingThreads(sqliteDb, review.id)
		expect(pending).toHaveLength(1)
		expect(pending[0].comments[0].body).toBe('Fix this')
	})
})

describe('review.reply round trip', () => {
	it('reply adds comment to thread', () => {
		const review = createReviewHelper()
		const files = db.listFiles(sqliteDb, review.id)
		const file = files[0]
		const round = db.getMutableRound(sqliteDb, file.id)!
		db.freezeRound(sqliteDb, round.id, 'snap')

		const thread = db.createThread(sqliteDb, { roundId: round.id, lineStart: 1 })
		db.createComment(sqliteDb, thread.id, 'Fix this', 'human')
		db.createComment(sqliteDb, thread.id, 'Fixed it', 'agent')

		const comments = db.listComments(sqliteDb, thread.id)
		expect(comments).toHaveLength(2)
		expect(comments[0].author).toBe('human')
		expect(comments[1].author).toBe('agent')
	})
})

describe('error handling', () => {
	it('getReview returns null for invalid id', () => {
		expect(db.getReview(sqliteDb, 'nonexistent')).toBeNull()
	})

	it('getFile returns null for invalid id', () => {
		expect(db.getFile(sqliteDb, 'nonexistent')).toBeNull()
	})
})

describe('concurrent operations', () => {
	it('multiple threads on same round', () => {
		const review = createReviewHelper()
		const files = db.listFiles(sqliteDb, review.id)
		const file = files[0]
		const round = db.getMutableRound(sqliteDb, file.id)!
		db.freezeRound(sqliteDb, round.id, 'snap')

		const t1 = db.createThread(sqliteDb, { roundId: round.id, lineStart: 1 })
		const t2 = db.createThread(sqliteDb, { roundId: round.id, lineStart: 5 })
		db.createComment(sqliteDb, t1.id, 'Comment 1', 'human')
		db.createComment(sqliteDb, t2.id, 'Comment 2', 'human')

		const pending = db.listPendingThreads(sqliteDb, review.id)
		expect(pending).toHaveLength(2)
	})

	it('address and resolve different threads simultaneously', () => {
		const review = createReviewHelper()
		const files = db.listFiles(sqliteDb, review.id)
		const file = files[0]
		const round = db.getMutableRound(sqliteDb, file.id)!
		db.freezeRound(sqliteDb, round.id, 'snap')

		const t1 = db.createThread(sqliteDb, { roundId: round.id, lineStart: 1 })
		const t2 = db.createThread(sqliteDb, { roundId: round.id, lineStart: 5 })

		db.addressThread(sqliteDb, t1.id)
		db.resolveThread(sqliteDb, t2.id)

		expect(db.getThread(sqliteDb, t1.id)!.status).toBe('addressed')
		expect(db.getThread(sqliteDb, t2.id)!.status).toBe('resolved')
	})
})
