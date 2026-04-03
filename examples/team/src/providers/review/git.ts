/**
 * Git operations for the review provider.
 *
 * Functions accept a `ctx` parameter for node builtins so they work both:
 * - In tests (direct import of node:*)
 * - In SES compartment (passed via ring0)
 */

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createPatch } from 'diff'

// ── Types ────────────────────────────────────────────────────

export type { DiffHunk, DiffLine } from './diff-parser'
import { parseDiffFromPatch } from './diff-parser'
export { parseDiffFromPatch }

// ── Git commands ─────────────────────────────────────────────

const git = (args: string, cwd: string): string => {
	return execSync(`git ${args}`, { cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }).trim()
}

export const getRepoRoot = (cwd: string): string => {
	return git('rev-parse --show-toplevel', cwd)
}

export const getFileAtRef = (repoRoot: string, filePath: string, ref: string): string | null => {
	try {
		const relPath = relative(repoRoot, join(repoRoot, filePath))
		return git(`show ${ref}:${relPath}`, repoRoot)
	}
	catch {
		return null
	}
}

export const getFileContent = (repoRoot: string, filePath: string): string | null => {
	try {
		return readFileSync(join(repoRoot, filePath), 'utf-8')
	}
	catch {
		return null
	}
}

export const getVisibleFiles = (repoRoot: string): string[] => {
	const tracked = git('ls-files', repoRoot).split('\n').filter(l => l.length > 0)
	const untracked = git('ls-files --others --exclude-standard', repoRoot).split('\n').filter(l => l.length > 0)
	const all = new Set([...tracked, ...untracked])
	return [...all].sort()
}

export const getChangedFiles = (repoRoot: string, ref: string): string[] => {
	let diffFiles: string[] = []
	try {
		const diff = git(`diff --name-only ${ref}`, repoRoot)
		diffFiles = diff.split('\n').filter(l => l.length > 0)
	}
	catch { /* ref might not exist */ }

	let stagedFiles: string[] = []
	try {
		const staged = git(`diff --name-only --cached ${ref}`, repoRoot)
		stagedFiles = staged.split('\n').filter(l => l.length > 0)
	}
	catch { /* ref might not exist */ }

	const untracked = git('ls-files --others --exclude-standard', repoRoot).split('\n').filter(l => l.length > 0)
	const all = new Set([...diffFiles, ...stagedFiles, ...untracked])
	return [...all].sort()
}

export const isIgnored = (repoRoot: string, filePath: string): boolean => {
	try {
		execSync(`git check-ignore -q ${filePath}`, { cwd: repoRoot, encoding: 'utf-8' })
		return true
	}
	catch {
		return false
	}
}

export const computeDiff = (oldContent: string, newContent: string, filePath: string): string => {
	return createPatch(filePath, oldContent, newContent)
}

export const parseDiff = (oldContent: string, newContent: string, filePath: string) => {
	return parseDiffFromPatch(createPatch(filePath, oldContent, newContent))
}
