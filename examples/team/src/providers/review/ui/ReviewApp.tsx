/**
 * ReviewApp — main review layout.
 *
 * File list on the left, panels on the right.
 * Panels scroll horizontally. Completed rounds are collapsed.
 */

import { useState, useEffect, useCallback } from 'react'
import { exoRpc } from './rpc'
import { FileList } from './FileList'
import { DiffPane } from './DiffPane'
import { ThreadView } from './ThreadView'
import type { ReviewProviderImpl, ThreadWithComments, FileDiff } from '../index'
import type { ReviewFile, Round } from '../db'

type ReviewCaps = { review: ReviewProviderImpl }

export const ReviewApp = ({ reviewId, onBack }: { reviewId: string, onBack: () => void }) => {
	const [files, setFiles] = useState<ReviewFile[]>([])
	const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
	const [diff, setDiff] = useState<FileDiff | null>(null)
	const [threads, setThreads] = useState<ThreadWithComments[]>([])
	const [error, setError] = useState('')

	// Load files
	useEffect(() => {
		exoRpc<ReviewCaps>(
			({ review }) => review.files(rid),
			{ rid: reviewId },
		).then((result: any) => setFiles(result as ReviewFile[]))
			.catch((err: Error) => setError(err.message))
	}, [reviewId])

	// Load diff + threads when file selected
	const loadFileData = useCallback(async (fileId: string) => {
		try {
			const [diffResult, threadsResult] = await Promise.all([
				exoRpc<ReviewCaps>(
					({ review }) => review.fileDiff(rid, fid),
					{ rid: reviewId, fid: fileId },
				),
				exoRpc<ReviewCaps>(
					({ review }) => review.fileThreads(rid, fid),
					{ rid: reviewId, fid: fileId },
				),
			])
			setDiff(diffResult as FileDiff | null)
			setThreads(threadsResult as ThreadWithComments[])
		}
		catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		}
	}, [reviewId])

	useEffect(() => {
		if (selectedFileId) {
			loadFileData(selectedFileId)
			// Poll for updates every 2s
			const interval = setInterval(() => loadFileData(selectedFileId), 2000)
			return () => clearInterval(interval)
		}
	}, [selectedFileId, loadFileData])

	const handleCreateThread = async (lineStart: number, body: string) => {
		if (!selectedFileId) { return }
		try {
			await exoRpc<ReviewCaps>(
				({ review }) => review.createThread(fid, line, body, author),
				{ fid: selectedFileId, line: lineStart, body, author: 'human' },
			)
			await loadFileData(selectedFileId)
		}
		catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		}
	}

	const handleReply = async (threadId: string, body: string) => {
		try {
			await exoRpc<ReviewCaps>(
				({ review }) => review.reply(tid, body, author),
				{ tid: threadId, body, author: 'human' },
			)
			if (selectedFileId) { await loadFileData(selectedFileId) }
		}
		catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		}
	}

	const handleThreadAction = async (action: string, threadId: string) => {
		try {
			if (action === 'resolve') {
				await exoRpc<ReviewCaps>(({ review }) => review.resolve(tid), { tid: threadId })
			}
			else if (action === 'address') {
				await exoRpc<ReviewCaps>(({ review }) => review.address(tid), { tid: threadId })
			}
			else if (action === 'reopen') {
				await exoRpc<ReviewCaps>(({ review }) => review.reopen(tid), { tid: threadId })
			}
			else if (action === 'wontfix') {
				await exoRpc<ReviewCaps>(({ review }) => review.wontfix(tid), { tid: threadId })
			}
			else if (action === 'defer') {
				if (selectedFileId) {
					await exoRpc<ReviewCaps>(
						({ review }) => review.defer(tid, fid),
						{ tid: threadId, fid: selectedFileId },
					)
				}
			}
			if (selectedFileId) { await loadFileData(selectedFileId) }
		}
		catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		}
	}

	return (
		<div style={{ display: 'flex', height: '100vh' }} data-testid="review-app">
			<FileList
				files={files}
				selectedFileId={selectedFileId}
				onSelect={setSelectedFileId}
			/>

			<div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
				{/* Header */}
				<div style={{ padding: '8px 16px', background: '#222', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', gap: 12 }}>
					<button onClick={onBack} style={{ background: 'none', border: 'none', color: '#4a9eff', cursor: 'pointer', fontSize: 14 }}>
						← Back
					</button>
					<span style={{ fontWeight: 'bold' }}>Review</span>
					{error && <span style={{ color: '#f44', fontSize: 12 }}>{error}</span>}
				</div>

				{/* Panels */}
				{selectedFileId && diff ? (
					<div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
						{/* Diff panels - horizontal scroll */}
						<div style={{ flex: 1, display: 'flex', overflowX: 'auto' }} data-testid="panels-container">
							{/* Base panel (round 1 old content) */}
							<DiffPane
								roundNum={0}
								isMutable={false}
								oldContent={diff.old_content}
								newContent={diff.old_content}
								hunks={[]}
								threads={[]}
								isFirst={true}
							/>

							{/* Current diff panel */}
							<DiffPane
								roundNum={diff.round_num}
								isMutable={true}
								oldContent={diff.old_content}
								newContent={diff.new_content}
								hunks={diff.hunks}
								threads={threads}
								onCreateThread={handleCreateThread}
							/>
						</div>

						{/* Thread sidebar */}
						{threads.length > 0 && (
							<div style={{ width: 350, borderLeft: '1px solid #333', overflow: 'auto', padding: 12 }} data-testid="thread-sidebar">
								<div style={{ fontWeight: 'bold', marginBottom: 12 }}>
									Threads ({threads.length})
								</div>
								{threads.map(t => (
									<ThreadView
										key={t.id}
										thread={t}
										onReply={handleReply}
										onResolve={(id) => handleThreadAction('resolve', id)}
										onDefer={(id) => handleThreadAction('defer', id)}
										onReopen={(id) => handleThreadAction('reopen', id)}
										onWontfix={(id) => handleThreadAction('wontfix', id)}
										onAddress={(id) => handleThreadAction('address', id)}
									/>
								))}
							</div>
						)}
					</div>
				) : (
					<div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
						Select a file to review
					</div>
				)}
			</div>
		</div>
	)
}
