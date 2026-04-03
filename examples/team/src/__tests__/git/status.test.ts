import { writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, afterEach } from 'vitest'
import { createTestRepo } from '../fixtures'
import { getChangedFiles } from '../../providers/review/git'

let repo: ReturnType<typeof createTestRepo>

afterEach(() => {
	repo?.cleanup()
})

describe('getChangedFiles', () => {
	it('detects modified tracked files', () => {
		repo = createTestRepo()
		const changed = getChangedFiles(repo.dir, 'HEAD')
		expect(changed).toContain('hello.ts')
	})

	it('detects untracked files (not ignored)', () => {
		repo = createTestRepo()
		const changed = getChangedFiles(repo.dir, 'HEAD')
		expect(changed).toContain('new-file.ts')
	})

	it('does not include unchanged tracked files', () => {
		repo = createTestRepo()
		const changed = getChangedFiles(repo.dir, 'HEAD')
		expect(changed).not.toContain('utils.ts')
	})

	it('detects deleted files', () => {
		repo = createTestRepo()
		unlinkSync(join(repo.dir, 'utils.ts'))
		const changed = getChangedFiles(repo.dir, 'HEAD')
		expect(changed).toContain('utils.ts')
	})

	it('does not include ignored files', () => {
		repo = createTestRepo()
		const changed = getChangedFiles(repo.dir, 'HEAD')
		expect(changed).not.toContain('build/output.js')
	})
})
