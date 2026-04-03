import { writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, afterEach } from 'vitest'
import { createTestRepo } from '../fixtures'
import {
	getFileAtRef,
	getFileContent,
	computeDiff,
	parseDiff,
} from '../../providers/review/git'

let repo: ReturnType<typeof createTestRepo>

afterEach(() => {
	repo?.cleanup()
})

describe('getFileAtRef', () => {
	it('returns file content at HEAD', () => {
		repo = createTestRepo()
		const content = getFileAtRef(repo.dir, 'hello.ts', 'HEAD')
		expect(content).toBe('const x = 1')
	})

	it('returns null for file that does not exist at ref', () => {
		repo = createTestRepo()
		const content = getFileAtRef(repo.dir, 'new-file.ts', 'HEAD')
		expect(content).toBeNull()
	})

	it('returns null for nonexistent file', () => {
		repo = createTestRepo()
		const content = getFileAtRef(repo.dir, 'nope.ts', 'HEAD')
		expect(content).toBeNull()
	})
})

describe('getFileContent', () => {
	it('returns current working tree content', () => {
		repo = createTestRepo()
		const content = getFileContent(repo.dir, 'hello.ts')
		expect(content).toBe('const x = 2\nconst y = 3\n')
	})

	it('returns null for nonexistent file', () => {
		repo = createTestRepo()
		expect(getFileContent(repo.dir, 'nope.ts')).toBeNull()
	})
})

describe('computeDiff', () => {
	it('shows changes between old and new content', () => {
		const diff = computeDiff('const x = 1\n', 'const x = 2\nconst y = 3\n', 'hello.ts')
		expect(diff).toContain('-const x = 1')
		expect(diff).toContain('+const x = 2')
		expect(diff).toContain('+const y = 3')
	})

	it('returns empty-ish diff for identical content', () => {
		const diff = computeDiff('same\n', 'same\n', 'file.ts')
		// No hunk markers means no changes
		expect(diff).not.toContain('@@')
	})
})

describe('parseDiff', () => {
	it('parses hunks with add/remove/context lines', () => {
		const hunks = parseDiff('const x = 1\n', 'const x = 2\nconst y = 3\n', 'hello.ts')
		expect(hunks.length).toBeGreaterThan(0)
		const lines = hunks[0].lines
		const adds = lines.filter(l => l.type === 'add')
		const removes = lines.filter(l => l.type === 'remove')
		expect(adds.length).toBeGreaterThan(0)
		expect(removes.length).toBeGreaterThan(0)
	})

	it('handles new file (empty old)', () => {
		const hunks = parseDiff('', 'export const NEW = true\n', 'new-file.ts')
		expect(hunks.length).toBeGreaterThan(0)
		const adds = hunks[0].lines.filter(l => l.type === 'add')
		expect(adds.length).toBeGreaterThan(0)
		expect(hunks[0].lines.filter(l => l.type === 'remove')).toHaveLength(0)
	})

	it('handles deleted file (empty new)', () => {
		const hunks = parseDiff('export const OLD = true\n', '', 'deleted.ts')
		expect(hunks.length).toBeGreaterThan(0)
		const removes = hunks[0].lines.filter(l => l.type === 'remove')
		expect(removes.length).toBeGreaterThan(0)
		expect(hunks[0].lines.filter(l => l.type === 'add')).toHaveLength(0)
	})

	it('line numbers are correct', () => {
		const hunks = parseDiff('a\nb\nc\n', 'a\nB\nc\n', 'file.ts')
		expect(hunks.length).toBe(1)
		const hunk = hunks[0]
		// Should have context, remove, add, context
		const remove = hunk.lines.find(l => l.type === 'remove')
		const add = hunk.lines.find(l => l.type === 'add')
		expect(remove?.oldLineNum).toBe(2)
		expect(add?.newLineNum).toBe(2)
	})
})
