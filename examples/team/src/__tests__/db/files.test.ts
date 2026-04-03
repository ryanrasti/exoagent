import Database from 'better-sqlite3'
import { describe, expect, it, beforeEach } from 'vitest'
import {
	initSchema,
	createReview,
	addFile,
	listFiles,
	getFile,
	updateFileStatus,
} from '../../providers/review/db'

let db: Database.Database

beforeEach(() => {
	db = new Database(':memory:')
	initSchema(db)
})

describe('addFile', () => {
	it('adds a file to a review', () => {
		const r = createReview(db, { baseRef: 'HEAD', repoRoot: '/tmp/repo' })
		const f = addFile(db, r.id, 'src/hello.ts')
		expect(f.id).toBeTruthy()
		expect(f.review_id).toBe(r.id)
		expect(f.path).toBe('src/hello.ts')
		expect(f.status).toBe('pending')
	})
})

describe('listFiles', () => {
	it('returns files ordered by path', () => {
		const r = createReview(db, { baseRef: 'HEAD', repoRoot: '/tmp/repo' })
		addFile(db, r.id, 'src/z.ts')
		addFile(db, r.id, 'src/a.ts')
		const files = listFiles(db, r.id)
		expect(files).toHaveLength(2)
		expect(files[0].path).toBe('src/a.ts')
		expect(files[1].path).toBe('src/z.ts')
	})

	it('returns empty for review with no files', () => {
		const r = createReview(db, { baseRef: 'HEAD', repoRoot: '/tmp/repo' })
		expect(listFiles(db, r.id)).toHaveLength(0)
	})
})

describe('getFile', () => {
	it('returns file by id', () => {
		const r = createReview(db, { baseRef: 'HEAD', repoRoot: '/tmp/repo' })
		const f = addFile(db, r.id, 'src/hello.ts')
		const got = getFile(db, f.id)
		expect(got).not.toBeNull()
		expect(got!.path).toBe('src/hello.ts')
	})

	it('returns null for unknown id', () => {
		expect(getFile(db, 'nonexistent')).toBeNull()
	})
})

describe('updateFileStatus', () => {
	it('transitions file status', () => {
		const r = createReview(db, { baseRef: 'HEAD', repoRoot: '/tmp/repo' })
		const f = addFile(db, r.id, 'src/hello.ts')
		expect(getFile(db, f.id)!.status).toBe('pending')

		updateFileStatus(db, f.id, 'reviewing')
		expect(getFile(db, f.id)!.status).toBe('reviewing')

		updateFileStatus(db, f.id, 'done')
		expect(getFile(db, f.id)!.status).toBe('done')
	})
})
