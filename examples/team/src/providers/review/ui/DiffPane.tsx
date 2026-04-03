/**
 * DiffPane — renders a single round's diff with thread anchors.
 *
 * Shows diff coloring relative to left neighbor (base_content → snap_content or worktree).
 * Clicking a line opens a comment input for creating threads.
 */

import { useState } from 'react'
import type { DiffHunk, DiffLine } from '../git'
import type { Thread, Comment } from '../db'

export type DiffPaneProps = {
	roundNum: number
	isMutable: boolean
	oldContent: string
	newContent: string
	hunks: DiffHunk[]
	threads: (Thread & { comments: Comment[] })[]
	onCreateThread?: (lineStart: number, body: string) => void
	isFirst?: boolean // first panel = no diff coloring
}

const lineColors = {
	add: { background: 'rgba(0, 180, 0, 0.15)', borderLeft: '3px solid #0b0' },
	remove: { background: 'rgba(255, 0, 0, 0.12)', borderLeft: '3px solid #f44' },
	context: { background: 'transparent', borderLeft: '3px solid transparent' },
}

export const DiffPane = ({
	roundNum,
	isMutable,
	oldContent,
	newContent,
	hunks,
	threads,
	onCreateThread,
	isFirst = false,
}: DiffPaneProps) => {
	const [commentLine, setCommentLine] = useState<number | null>(null)
	const [commentText, setCommentText] = useState('')

	const handleLineClick = (lineNum: number) => {
		if (!onCreateThread) { return }
		setCommentLine(lineNum)
		setCommentText('')
	}

	const handleSubmit = () => {
		if (!commentLine || !commentText.trim() || !onCreateThread) { return }
		onCreateThread(commentLine, commentText.trim())
		setCommentLine(null)
		setCommentText('')
	}

	// For the first panel (base ref), just show plain source
	if (isFirst) {
		const lines = oldContent.split('\n')
		return (
			<div data-testid={`diff-pane-${roundNum}`} style={{ flex: 1, overflow: 'auto', fontFamily: 'monospace', fontSize: 13 }}>
				<div style={{ padding: '8px 12px', fontWeight: 'bold', borderBottom: '1px solid #333', background: '#222' }}>
					Round {roundNum} (base)
				</div>
				{lines.map((line, i) => (
					<div key={i} style={{ padding: '1px 12px', whiteSpace: 'pre' }} data-testid={`line-${i + 1}`}>
						<span style={{ color: '#666', display: 'inline-block', width: 40, textAlign: 'right', marginRight: 12 }}>
							{i + 1}
						</span>
						{line}
					</div>
				))}
			</div>
		)
	}

	// Thread markers: map line numbers to threads
	const threadsByLine = new Map<number, (Thread & { comments: Comment[] })[]>()
	for (const t of threads) {
		const existing = threadsByLine.get(t.line_start) ?? []
		existing.push(t)
		threadsByLine.set(t.line_start, existing)
	}

	return (
		<div data-testid={`diff-pane-${roundNum}`} style={{ flex: 1, overflow: 'auto', fontFamily: 'monospace', fontSize: 13 }}>
			<div style={{ padding: '8px 12px', fontWeight: 'bold', borderBottom: '1px solid #333', background: '#222' }}>
				Round {roundNum} {isMutable ? '(live)' : ''}
			</div>
			{hunks.length === 0 && (
				<div style={{ padding: 12, color: '#888' }}>No changes</div>
			)}
			{hunks.map((hunk, hi) => (
				<div key={hi} data-testid={`hunk-${hi}`}>
					<div style={{ padding: '4px 12px', color: '#888', background: '#1a1a2e' }}>
						@@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
					</div>
					{hunk.lines.map((line, li) => {
						const lineNum = line.newLineNum ?? line.oldLineNum ?? 0
						const style = isFirst ? lineColors.context : lineColors[line.type]
						const hasThread = line.newLineNum !== null && threadsByLine.has(lineNum)

						return (
							<div key={li}>
								<div
									onClick={() => lineNum > 0 && handleLineClick(lineNum)}
									data-testid={`diff-line-${line.type}-${lineNum}`}
									style={{
										padding: '1px 12px',
										whiteSpace: 'pre',
										cursor: onCreateThread ? 'pointer' : 'default',
										...style,
										...(hasThread ? { borderRight: '3px solid #4a9eff' } : {}),
									}}
								>
									<span style={{ color: '#666', display: 'inline-block', width: 40, textAlign: 'right', marginRight: 12 }}>
										{lineNum || ''}
									</span>
									<span style={{ color: line.type === 'add' ? '#4caf50' : line.type === 'remove' ? '#f44' : '#e0e0e0' }}>
										{line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}{line.content}
									</span>
								</div>

								{/* Thread markers */}
								{hasThread && threadsByLine.get(lineNum)!.map(t => (
									<div key={t.id} data-testid={`thread-marker-${t.id}`} style={{
										padding: '4px 12px 4px 64px',
										background: '#1a2a3a',
										borderLeft: '3px solid #4a9eff',
										fontSize: 12,
									}}>
										<span style={{
											padding: '2px 6px',
											borderRadius: 3,
											background: t.status === 'resolved' ? '#2e7d32' : t.status === 'addressed' ? '#f57f17' : '#1565c0',
											color: '#fff',
											fontSize: 11,
											marginRight: 8,
										}}>
											{t.status}
										</span>
										{t.comments[0]?.body ?? '(no comment)'}
									</div>
								))}

								{/* Comment input */}
								{commentLine === lineNum && line.newLineNum !== null && (
									<div style={{ padding: '8px 12px 8px 64px', background: '#1a2a1a' }} data-testid="comment-input">
										<textarea
											value={commentText}
											onChange={e => setCommentText(e.target.value)}
											placeholder="Add a comment..."
											data-testid="comment-textarea"
											style={{
												width: '100%',
												minHeight: 60,
												background: '#2a2a2a',
												border: '1px solid #444',
												borderRadius: 4,
												color: '#e0e0e0',
												padding: 8,
												fontSize: 13,
												fontFamily: 'system-ui',
												boxSizing: 'border-box',
											}}
										/>
										<div style={{ marginTop: 4, display: 'flex', gap: 8 }}>
											<button
												onClick={handleSubmit}
												data-testid="comment-submit"
												style={{ padding: '4px 12px', background: '#4a9eff', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
											>
												Comment
											</button>
											<button
												onClick={() => setCommentLine(null)}
												data-testid="comment-cancel"
												style={{ padding: '4px 12px', background: '#555', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
											>
												Cancel
											</button>
										</div>
									</div>
								)}
							</div>
						)
					})}
				</div>
			))}
		</div>
	)
}
