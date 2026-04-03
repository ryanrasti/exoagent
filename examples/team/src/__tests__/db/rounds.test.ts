import Database from 'better-sqlite3'
import { describe, expect, it, beforeEach } from 'vitest'
import {
	initSchema,
	createReview,
	addFile,
	createRound,
	getRound,
	listRounds,
	getMutableRound,
	freezeRound,
} from '../../providers/review/db'

let db: Database.Database

beforeEach(() => {
	db = new Database(':memory:')
	initSchema(db)
})

const setup = () => {
	const r = createReview(db, { baseRef: 'HEAD', repoRoot: '/tmp/repo' })
	const f = addFile(db, r.id, 'src/hello.ts')
	return { review: r, file: f }
}

describe('createRound', () => {
	it('creates round 1 with snap_content = NULL (mutable)', () => {
		const { file } = setup()
		const round = createRound(db, file.id, 1, 'const x = 1\n')
		expect(round.round_num).toBe(1)
		expect(round.base_content).toBe('const x = 1\n')
		expect(round.snap_content).toBeNull()
	})

	it('round 1 base_content is file content at base ref', () => {
		const { file } = setup()
		const round = createRound(db, file.id, 1, 'original content')
		expect(round.base_content).toBe('original content')
	})
})

describe('freezeRound', () => {
	it('sets snap_content to current file content', () => {
		const { file } = setup()
		const round = createRound(db, file.id, 1, 'const x = 1\n')
		freezeRound(db, round.id, 'const x = 2\n')
		const got = getRound(db, round.id)
		expect(got!.snap_content).toBe('const x = 2\n')
	})
})

describe('getMutableRound', () => {
	it('returns the round with snap_content = NULL', () => {
		const { file } = setup()
		createRound(db, file.id, 1, 'v1')
		const mutable = getMutableRound(db, file.id)
		expect(mutable).not.toBeNull()
		expect(mutable!.round_num).toBe(1)
	})

	it('returns null when all rounds are frozen', () => {
		const { file } = setup()
		const round = createRound(db, file.id, 1, 'v1')
		freezeRound(db, round.id, 'v1-snap')
		expect(getMutableRound(db, file.id)).toBeNull()
	})

	it('returns the latest mutable round', () => {
		const { file } = setup()
		const r1 = createRound(db, file.id, 1, 'v1')
		freezeRound(db, r1.id, 'v1-snap')
		createRound(db, file.id, 2, 'v1-snap')
		const mutable = getMutableRound(db, file.id)
		expect(mutable!.round_num).toBe(2)
	})
})

describe('freeze creates new mutable round', () => {
	it('new round base_content = previous round snap_content', () => {
		const { file } = setup()
		const r1 = createRound(db, file.id, 1, 'v1')
		freezeRound(db, r1.id, 'v1-frozen')
		const r2 = createRound(db, file.id, 2, 'v1-frozen')
		expect(r2.base_content).toBe('v1-frozen')
		expect(r2.snap_content).toBeNull()
	})
})

describe('listRounds', () => {
	it('returns rounds ordered by round_num', () => {
		const { file } = setup()
		const r1 = createRound(db, file.id, 1, 'v1')
		freezeRound(db, r1.id, 'v1-snap')
		createRound(db, file.id, 2, 'v1-snap')
		const rounds = listRounds(db, file.id)
		expect(rounds).toHaveLength(2)
		expect(rounds[0].round_num).toBe(1)
		expect(rounds[1].round_num).toBe(2)
	})
})

describe('multiple freezes increment round_num', () => {
	it('3 rounds', () => {
		const { file } = setup()
		const r1 = createRound(db, file.id, 1, 'v1')
		freezeRound(db, r1.id, 'snap1')
		const r2 = createRound(db, file.id, 2, 'snap1')
		freezeRound(db, r2.id, 'snap2')
		const r3 = createRound(db, file.id, 3, 'snap2')
		expect(r3.round_num).toBe(3)
		expect(r3.base_content).toBe('snap2')
		expect(listRounds(db, file.id)).toHaveLength(3)
	})
})
