import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, afterEach } from 'vitest'
import { createTestRepo } from '../fixtures'
import { getVisibleFiles, isIgnored } from '../../providers/review/git'

let repo: ReturnType<typeof createTestRepo>

afterEach(() => {
	repo?.cleanup()
})

describe('getVisibleFiles', () => {
	it('includes tracked files', () => {
		repo = createTestRepo()
		const files = getVisibleFiles(repo.dir)
		expect(files).toContain('hello.ts')
		expect(files).toContain('utils.ts')
	})

	it('includes untracked, not ignored files', () => {
		repo = createTestRepo()
		const files = getVisibleFiles(repo.dir)
		expect(files).toContain('new-file.ts')
	})

	it('does not include gitignored files', () => {
		repo = createTestRepo()
		const files = getVisibleFiles(repo.dir)
		expect(files).not.toContain('build/output.js')
	})

	it('includes .gitignore itself', () => {
		repo = createTestRepo()
		const files = getVisibleFiles(repo.dir)
		expect(files).toContain('.gitignore')
	})
})

describe('isIgnored', () => {
	it('returns true for gitignored paths', () => {
		repo = createTestRepo()
		expect(isIgnored(repo.dir, 'build/output.js')).toBe(true)
	})

	it('returns false for tracked files', () => {
		repo = createTestRepo()
		expect(isIgnored(repo.dir, 'hello.ts')).toBe(false)
	})

	it('returns false for untracked, not ignored files', () => {
		repo = createTestRepo()
		expect(isIgnored(repo.dir, 'new-file.ts')).toBe(false)
	})
})
