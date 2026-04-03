import Database from 'better-sqlite3'
import { describe, expect, it, beforeEach } from 'vitest'
import {
	initSchema,
	createReview,
	addFile,
	createRound,
	createThread,
	getThread,
	listThreads,
	addressThread,
	resolveThread,
	reopenThread,
	wontfixThread,
	deferThread,
	isRoundCollapsible,
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
	return { review: r, file: f, round }
}

describe('createThread', () => {
	it('creates a thread with status = open', () => {
		const { round } = setup()
		const t = createThread(db, { roundId: round.id, lineStart: 1 })
		expect(t.status).toBe('open')
		expect(t.line_start).toBe(1)
		expect(t.round_id).toBe(round.id)
		expect(t.original_round_id).toBe(round.id)
		expect(t.resolved_at).toBeNull()
	})

	it('stores snippet when provided', () => {
		const { round } = setup()
		const t = createThread(db, { roundId: round.id, lineStart: 1, lineEnd: 3, snippet: 'const x = 1\n' })
		expect(t.snippet).toBe('const x = 1\n')
		expect(t.line_end).toBe(3)
	})
})

describe('addressThread', () => {
	it('transitions open → addressed', () => {
		const { round } = setup()
		const t = createThread(db, { roundId: round.id, lineStart: 1 })
		addressThread(db, t.id)
		expect(getThread(db, t.id)!.status).toBe('addressed')
	})

	it('does not transition resolved → addressed', () => {
		const { round } = setup()
		const t = createThread(db, { roundId: round.id, lineStart: 1 })
		resolveThread(db, t.id)
		addressThread(db, t.id)
		expect(getThread(db, t.id)!.status).toBe('resolved')
	})
})

describe('resolveThread', () => {
	it('transitions open → resolved with resolved_at', () => {
		const { round } = setup()
		const t = createThread(db, { roundId: round.id, lineStart: 1 })
		resolveThread(db, t.id)
		const got = getThread(db, t.id)!
		expect(got.status).toBe('resolved')
		expect(got.resolved_at).toBeGreaterThan(0)
	})

	it('transitions addressed → resolved', () => {
		const { round } = setup()
		const t = createThread(db, { roundId: round.id, lineStart: 1 })
		addressThread(db, t.id)
		resolveThread(db, t.id)
		expect(getThread(db, t.id)!.status).toBe('resolved')
	})
})

describe('reopenThread', () => {
	it('transitions addressed → open', () => {
		const { round } = setup()
		const t = createThread(db, { roundId: round.id, lineStart: 1 })
		addressThread(db, t.id)
		reopenThread(db, t.id)
		const got = getThread(db, t.id)!
		expect(got.status).toBe('open')
		expect(got.resolved_at).toBeNull()
	})

	it('does not reopen resolved threads', () => {
		const { round } = setup()
		const t = createThread(db, { roundId: round.id, lineStart: 1 })
		resolveThread(db, t.id)
		reopenThread(db, t.id)
		expect(getThread(db, t.id)!.status).toBe('resolved')
	})
})

describe('wontfixThread', () => {
	it('transitions open → wontfix', () => {
		const { round } = setup()
		const t = createThread(db, { roundId: round.id, lineStart: 1 })
		wontfixThread(db, t.id)
		expect(getThread(db, t.id)!.status).toBe('wontfix')
	})

	it('transitions addressed → wontfix', () => {
		const { round } = setup()
		const t = createThread(db, { roundId: round.id, lineStart: 1 })
		addressThread(db, t.id)
		wontfixThread(db, t.id)
		expect(getThread(db, t.id)!.status).toBe('wontfix')
	})
})

describe('deferThread', () => {
	it('moves thread to target round, preserves original_round_id', () => {
		const { file, round } = setup()
		const t = createThread(db, { roundId: round.id, lineStart: 5 })
		const round2 = createRound(db, file.id, 2, 'v2')
		deferThread(db, t.id, round2.id)
		const got = getThread(db, t.id)!
		expect(got.round_id).toBe(round2.id)
		expect(got.original_round_id).toBe(round.id)
		expect(got.status).toBe('open')
	})
})

describe('listThreads', () => {
	it('returns threads for a round ordered by line_start', () => {
		const { round } = setup()
		createThread(db, { roundId: round.id, lineStart: 10 })
		createThread(db, { roundId: round.id, lineStart: 3 })
		const threads = listThreads(db, round.id)
		expect(threads).toHaveLength(2)
		expect(threads[0].line_start).toBe(3)
		expect(threads[1].line_start).toBe(10)
	})
})

describe('isRoundCollapsible', () => {
	it('empty round is collapsible', () => {
		const { round } = setup()
		expect(isRoundCollapsible(db, round.id)).toBe(true)
	})

	it('all resolved → collapsible', () => {
		const { round } = setup()
		const t1 = createThread(db, { roundId: round.id, lineStart: 1 })
		const t2 = createThread(db, { roundId: round.id, lineStart: 5 })
		resolveThread(db, t1.id)
		resolveThread(db, t2.id)
		expect(isRoundCollapsible(db, round.id)).toBe(true)
	})

	it('mix of resolved + wontfix → collapsible', () => {
		const { round } = setup()
		const t1 = createThread(db, { roundId: round.id, lineStart: 1 })
		const t2 = createThread(db, { roundId: round.id, lineStart: 5 })
		resolveThread(db, t1.id)
		wontfixThread(db, t2.id)
		expect(isRoundCollapsible(db, round.id)).toBe(true)
	})

	it('one open thread → not collapsible', () => {
		const { round } = setup()
		const t1 = createThread(db, { roundId: round.id, lineStart: 1 })
		const t2 = createThread(db, { roundId: round.id, lineStart: 5 })
		resolveThread(db, t1.id)
		// t2 still open
		expect(isRoundCollapsible(db, round.id)).toBe(false)
	})

	it('addressed thread → not collapsible', () => {
		const { round } = setup()
		const t1 = createThread(db, { roundId: round.id, lineStart: 1 })
		addressThread(db, t1.id)
		expect(isRoundCollapsible(db, round.id)).toBe(false)
	})

	it('deferred thread removed from round → collapsible', () => {
		const { file, round } = setup()
		const t1 = createThread(db, { roundId: round.id, lineStart: 1 })
		const round2 = createRound(db, file.id, 2, 'v2')
		deferThread(db, t1.id, round2.id)
		expect(isRoundCollapsible(db, round.id)).toBe(true)
	})
})
