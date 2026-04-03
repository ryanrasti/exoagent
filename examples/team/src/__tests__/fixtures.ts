/**
 * Shared test fixtures for review provider tests.
 */

import { execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { rmSync } from 'node:fs'

const exec = (cmd: string, cwd: string) => {
	execSync(cmd, { cwd, encoding: 'utf-8', stdio: 'pipe' })
}

/**
 * Creates a temp git repo with known state:
 * - hello.ts: modified (tracked)
 * - utils.ts: unchanged (tracked)
 * - new-file.ts: untracked
 * - .gitignore: ignores build/
 * - build/output.js: should be ignored
 */
export const createTestRepo = () => {
	const dir = mkdtempSync(join(tmpdir(), 'exopr-test-'))
	exec('git init', dir)
	exec('git config user.email "t@t"', dir)
	exec('git config user.name "T"', dir)

	// Create .gitignore
	writeFileSync(join(dir, '.gitignore'), 'build/\n')

	// Create tracked files
	writeFileSync(join(dir, 'hello.ts'), 'const x = 1\n')
	writeFileSync(join(dir, 'utils.ts'), 'export const add = (a: number, b: number) => a + b\n')
	exec('git add . && git commit -m "init"', dir)

	// Uncommitted changes
	writeFileSync(join(dir, 'hello.ts'), 'const x = 2\nconst y = 3\n')

	// New untracked file
	writeFileSync(join(dir, 'new-file.ts'), 'export const NEW = true\n')

	// Ignored file
	mkdirSync(join(dir, 'build'), { recursive: true })
	writeFileSync(join(dir, 'build', 'output.js'), 'compiled')

	const cleanup = () => {
		rmSync(dir, { recursive: true, force: true })
	}

	return { dir, cleanup }
}

/**
 * Creates a minimal test repo with just one file.
 */
export const createMinimalRepo = () => {
	const dir = mkdtempSync(join(tmpdir(), 'exopr-min-'))
	exec('git init', dir)
	exec('git config user.email "t@t"', dir)
	exec('git config user.name "T"', dir)
	writeFileSync(join(dir, 'file.ts'), 'line 1\nline 2\nline 3\n')
	exec('git add . && git commit -m "init"', dir)

	const cleanup = () => {
		rmSync(dir, { recursive: true, force: true })
	}

	return { dir, cleanup }
}
