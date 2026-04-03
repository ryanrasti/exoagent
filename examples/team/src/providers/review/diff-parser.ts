/**
 * Pure diff parsing — no node imports.
 * Safe to use in SES compartment.
 */

export type DiffHunk = {
	oldStart: number
	oldLines: number
	newStart: number
	newLines: number
	lines: DiffLine[]
}

export type DiffLine = {
	type: 'add' | 'remove' | 'context'
	content: string
	oldLineNum: number | null
	newLineNum: number | null
}

/**
 * Parse a unified diff patch string into structured hunks.
 */
export const parseDiffFromPatch = (patch: string): DiffHunk[] => {
	const lines = patch.split('\n')
	const hunks: DiffHunk[] = []
	let currentHunk: DiffHunk | null = null
	let oldLine = 0
	let newLine = 0

	for (const line of lines) {
		const hunkMatch = line.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/)
		if (hunkMatch) {
			currentHunk = {
				oldStart: Number.parseInt(hunkMatch[1]),
				oldLines: hunkMatch[2] ? Number.parseInt(hunkMatch[2]) : 1,
				newStart: Number.parseInt(hunkMatch[3]),
				newLines: hunkMatch[4] ? Number.parseInt(hunkMatch[4]) : 1,
				lines: [],
			}
			hunks.push(currentHunk)
			oldLine = currentHunk.oldStart
			newLine = currentHunk.newStart
			continue
		}

		if (!currentHunk) { continue }

		if (line.startsWith('+')) {
			currentHunk.lines.push({ type: 'add', content: line.slice(1), oldLineNum: null, newLineNum: newLine })
			newLine++
		}
		else if (line.startsWith('-')) {
			currentHunk.lines.push({ type: 'remove', content: line.slice(1), oldLineNum: oldLine, newLineNum: null })
			oldLine++
		}
		else if (line.startsWith(' ')) {
			currentHunk.lines.push({ type: 'context', content: line.slice(1), oldLineNum: oldLine, newLineNum: newLine })
			oldLine++
			newLine++
		}
	}

	return hunks
}
