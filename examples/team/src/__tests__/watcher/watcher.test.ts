/**
 * File watcher tests.
 * Creates a temp git repo and verifies chokidar + git filtering works.
 */

import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, afterEach } from 'vitest'
import { createTestRepo } from '../fixtures'
import { createWatcher } from '../../providers/review/watcher'

let repo: ReturnType<typeof createTestRepo>
let watcher: Awaited<ReturnType<typeof createWatcher>> | null = null

afterEach(async () => {
	if (watcher) {
		await watcher.close()
		watcher = null
	}
	repo?.cleanup()
})

const waitForChange = (repoDir: string, timeout = 3000): Promise<string> => {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('timeout waiting for file change')), timeout)
		watcher = createWatcher(repoDir, (filePath) => {
			clearTimeout(timer)
			resolve(filePath)
		})
	})
}

describe('createWatcher', () => {
	it('detects modified tracked file', async () => {
		repo = createTestRepo()
		const promise = waitForChange(repo.dir)
		// Wait for watcher to be ready
		await new Promise(r => setTimeout(r, 500))
		writeFileSync(join(repo.dir, 'hello.ts'), 'const x = 999\n')
		const changed = await promise
		expect(changed).toBe('hello.ts')
	})

	it('detects new file', async () => {
		repo = createTestRepo()
		const promise = waitForChange(repo.dir)
		await new Promise(r => setTimeout(r, 500))
		writeFileSync(join(repo.dir, 'brand-new.ts'), 'new file\n')
		const changed = await promise
		expect(changed).toBe('brand-new.ts')
	})

	it('detects deleted file', async () => {
		repo = createTestRepo()
		const promise = waitForChange(repo.dir)
		await new Promise(r => setTimeout(r, 500))
		unlinkSync(join(repo.dir, 'hello.ts'))
		const changed = await promise
		expect(changed).toBe('hello.ts')
	})

	it('ignores .git directory changes', async () => {
		repo = createTestRepo()
		const changes: string[] = []
		watcher = createWatcher(repo.dir, (filePath) => {
			changes.push(filePath)
		})
		await new Promise(r => setTimeout(r, 500))
		// Write to .git — should be ignored
		writeFileSync(join(repo.dir, '.git', 'test-file'), 'ignored\n')
		// Write to tracked file — should be detected
		writeFileSync(join(repo.dir, 'hello.ts'), 'const x = 42\n')
		await new Promise(r => setTimeout(r, 1000))
		expect(changes).toContain('hello.ts')
		expect(changes).not.toContain('.git/test-file')
	})
})
