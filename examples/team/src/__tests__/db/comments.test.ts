import Database from 'better-sqlite3'
import { describe, expect, it, beforeEach } from 'vitest'
import {
	initSchema,
	createReview,
	addFile,
	createRound,
	createThread,
	createComment,
	listComments,
} from '../../providers/review/db'

let db: Database.Database

beforeEach(() => {
	db = new Database(':memory:')
	initSchema(db)
})

const setup = () => {
	const r = createReview(db, { baseRef: 'HEAD', repoRoot: '/tmp/repo' })
	const f = addFile(db, r.id, 'src/hello.ts')
	const round = createRound(db, f.id, 1, 'const x = 1\n')
	const thread = createThread(db, { roundId: round.id, lineStart: 1 })
	return { review: r, file: f, round, thread }
}

describe('createComment', () => {
	it('creates a comment with correct author and body', () => {
		const { thread } = setup()
		const c = createComment(db, thread.id, 'Fix this', 'human')
		expect(c.id).toBeTruthy()
		expect(c.thread_id).toBe(thread.id)
		expect(c.body).toBe('Fix this')
		expect(c.author).toBe('human')
		expect(c.created_at).toBeGreaterThan(0)
	})

	it('creates agent comments', () => {
		const { thread } = setup()
		const c = createComment(db, thread.id, 'Fixed it', 'agent')
		expect(c.author).toBe('agent')
	})
})

describe('listComments', () => {
	it('returns comments ordered by created_at', () => {
		const { thread } = setup()
		createComment(db, thread.id, 'First', 'human')
		createComment(db, thread.id, 'Second', 'agent')
		createComment(db, thread.id, 'Third', 'human')
		const comments = listComments(db, thread.id)
		expect(comments).toHaveLength(3)
		expect(comments[0].body).toBe('First')
		expect(comments[1].body).toBe('Second')
		expect(comments[2].body).toBe('Third')
	})

	it('returns empty for thread with no comments', () => {
		const { thread } = setup()
		expect(listComments(db, thread.id)).toHaveLength(0)
	})

	it('isolates comments to their thread', () => {
		const { round, thread } = setup()
		createComment(db, thread.id, 'On thread 1', 'human')
		const thread2 = createThread(db, { roundId: round.id, lineStart: 5 })
		createComment(db, thread2.id, 'On thread 2', 'human')
		expect(listComments(db, thread.id)).toHaveLength(1)
		expect(listComments(db, thread2.id)).toHaveLength(1)
	})
})
