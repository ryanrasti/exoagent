import Database from 'better-sqlite3'
import { describe, expect, it, beforeEach } from 'vitest'
import {
	initSchema,
	createReview,
	getReview,
	findReviewByRef,
	listReviews,
	attachAgent,
} from '../../providers/review/db'

let db: Database.Database

beforeEach(() => {
	db = new Database(':memory:')
	initSchema(db)
})

describe('createReview', () => {
	it('creates a review and returns it', () => {
		const r = createReview(db, { baseRef: 'HEAD', repoRoot: '/tmp/repo' })
		expect(r.id).toBeTruthy()
		expect(r.base_ref).toBe('HEAD')
		expect(r.repo_root).toBe('/tmp/repo')
		expect(r.agent_client).toBeNull()
		expect(r.agent_session_id).toBeNull()
		expect(r.created_at).toBeGreaterThan(0)
	})

	it('creates a review with agent attachment', () => {
		const r = createReview(db, { baseRef: 'HEAD', repoRoot: '/tmp/repo', agentClient: 'pm', agentSessionId: 'main' })
		expect(r.agent_client).toBe('pm')
		expect(r.agent_session_id).toBe('main')
	})
})

describe('getReview', () => {
	it('returns review by id', () => {
		const r = createReview(db, { baseRef: 'HEAD', repoRoot: '/tmp/repo' })
		const got = getReview(db, r.id)
		expect(got).not.toBeNull()
		expect(got!.id).toBe(r.id)
		expect(got!.base_ref).toBe('HEAD')
	})

	it('returns null for unknown id', () => {
		expect(getReview(db, 'nonexistent')).toBeNull()
	})
})

describe('findReviewByRef', () => {
	it('finds the most recent review at a ref', () => {
		createReview(db, { baseRef: 'HEAD', repoRoot: '/tmp/repo' })
		const r2 = createReview(db, { baseRef: 'HEAD', repoRoot: '/tmp/repo' })
		const found = findReviewByRef(db, 'HEAD')
		expect(found).not.toBeNull()
		expect(found!.id).toBe(r2.id)
	})

	it('returns null when no review at ref', () => {
		expect(findReviewByRef(db, 'HEAD')).toBeNull()
	})
})

describe('listReviews', () => {
	it('returns all reviews', () => {
		createReview(db, { baseRef: 'HEAD', repoRoot: '/tmp/repo' })
		createReview(db, { baseRef: 'main', repoRoot: '/tmp/repo' })
		const all = listReviews(db)
		expect(all).toHaveLength(2)
	})
})

describe('attachAgent', () => {
	it('attaches agent to existing review', () => {
		const r = createReview(db, { baseRef: 'HEAD', repoRoot: '/tmp/repo' })
		attachAgent(db, r.id, 'pm', 'main')
		const got = getReview(db, r.id)
		expect(got!.agent_client).toBe('pm')
		expect(got!.agent_session_id).toBe('main')
	})
})
