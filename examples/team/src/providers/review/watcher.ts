/**
 * File watcher for the review provider.
 *
 * Uses chokidar to watch the repo root. On file change, checks if the
 * file is git-visible (not ignored) and notifies callbacks.
 */

import { watch } from 'chokidar'
import { relative } from 'node:path'
import { isIgnored } from './git'

export type FileChangeCallback = (filePath: string) => void

export type ReviewWatcher = {
	close: () => Promise<void>
}

/**
 * Watch a repo root for file changes. Only fires for git-visible files
 * (tracked or untracked-but-not-ignored).
 */
export const createWatcher = (repoRoot: string, onChange: FileChangeCallback): ReviewWatcher => {
	const watcher = watch(repoRoot, {
		ignored: [
			/(^|[\/\\])\.git[\/\\]/,
			/(^|[\/\\])node_modules[\/\\]/,
		],
		persistent: true,
		ignoreInitial: true,
		awaitWriteFinish: {
			stabilityThreshold: 200,
			pollInterval: 50,
		},
	})

	const handleChange = (absPath: string) => {
		const relPath = relative(repoRoot, absPath)
		// Skip if gitignored
		if (!isIgnored(repoRoot, relPath)) {
			onChange(relPath)
		}
	}

	watcher.on('change', handleChange)
	watcher.on('add', handleChange)
	watcher.on('unlink', (absPath) => {
		const relPath = relative(repoRoot, absPath)
		onChange(relPath)
	})

	return {
		close: () => watcher.close(),
	}
}
