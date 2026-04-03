/**
 * ThreadView — displays a thread with all its comments and action buttons.
 */

import { useState } from 'react'
import type { Thread, Comment } from '../db'

export type ThreadViewProps = {
	thread: Thread & { comments: Comment[], file_path: string }
	onReply: (threadId: string, body: string) => void
	onResolve: (threadId: string) => void
	onDefer: (threadId: string) => void
	onReopen: (threadId: string) => void
	onWontfix: (threadId: string) => void
	onAddress: (threadId: string) => void
}

const statusBadge = (status: string) => {
	const colors: { [key: string]: string } = {
		open: '#1565c0',
		addressed: '#f57f17',
		resolved: '#2e7d32',
		wontfix: '#666',
	}
	return (
		<span
			data-testid={`thread-status-${status}`}
			style={{
				padding: '2px 8px',
				borderRadius: 3,
				background: colors[status] ?? '#666',
				color: '#fff',
				fontSize: 11,
				fontWeight: 'bold',
			}}
		>
			{status}
		</span>
	)
}

export const ThreadView = ({
	thread,
	onReply,
	onResolve,
	onDefer,
	onReopen,
	onWontfix,
	onAddress,
}: ThreadViewProps) => {
	const [replyText, setReplyText] = useState('')
	const [showReply, setShowReply] = useState(false)

	const handleReply = () => {
		if (!replyText.trim()) { return }
		onReply(thread.id, replyText.trim())
		setReplyText('')
		setShowReply(false)
	}

	return (
		<div data-testid={`thread-view-${thread.id}`} style={{ border: '1px solid #333', borderRadius: 4, marginBottom: 12 }}>
			{/* Header */}
			<div style={{ padding: '8px 12px', background: '#222', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #333' }}>
				{statusBadge(thread.status)}
				<span style={{ color: '#4a9eff', fontSize: 12 }}>
					{thread.file_path}:{thread.line_start}
				</span>
				{thread.snippet && (
					<code style={{ color: '#888', fontSize: 11, marginLeft: 'auto' }}>
						{thread.snippet.slice(0, 40)}
					</code>
				)}
			</div>

			{/* Comments */}
			{thread.comments.map(c => (
				<div key={c.id} data-testid={`comment-${c.id}`} style={{ padding: '8px 12px', borderBottom: '1px solid #2a2a2a' }}>
					<div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
						<span style={{ fontWeight: 'bold', fontSize: 12, color: c.author === 'human' ? '#4a9eff' : '#4caf50' }}>
							{c.author}
						</span>
						<span style={{ color: '#666', fontSize: 11 }}>
							{new Date(c.created_at).toLocaleTimeString()}
						</span>
					</div>
					<div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{c.body}</div>
				</div>
			))}

			{/* Reply input */}
			{showReply && (
				<div style={{ padding: '8px 12px' }} data-testid="reply-input">
					<textarea
						value={replyText}
						onChange={e => setReplyText(e.target.value)}
						placeholder="Reply..."
						data-testid="reply-textarea"
						style={{
							width: '100%',
							minHeight: 50,
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
						<button onClick={handleReply} data-testid="reply-submit"
							style={{ padding: '4px 12px', background: '#4a9eff', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
							Reply
						</button>
						<button onClick={() => setShowReply(false)}
							style={{ padding: '4px 12px', background: '#555', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
							Cancel
						</button>
					</div>
				</div>
			)}

			{/* Actions */}
			<div style={{ padding: '8px 12px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
				{!showReply && (
					<button onClick={() => setShowReply(true)} data-testid="reply-button"
						style={{ padding: '4px 12px', background: '#333', color: '#e0e0e0', border: '1px solid #555', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
						Reply
					</button>
				)}
				{thread.status === 'open' && (
					<button onClick={() => onAddress(thread.id)} data-testid="address-button"
						style={{ padding: '4px 12px', background: '#333', color: '#f5a623', border: '1px solid #555', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
						Mark Addressed
					</button>
				)}
				{(thread.status === 'open' || thread.status === 'addressed') && (
					<>
						<button onClick={() => onResolve(thread.id)} data-testid="resolve-button"
							style={{ padding: '4px 12px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
							Resolve
						</button>
						<button onClick={() => onDefer(thread.id)} data-testid="defer-button"
							style={{ padding: '4px 12px', background: '#333', color: '#e0e0e0', border: '1px solid #555', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
							Defer
						</button>
						<button onClick={() => onWontfix(thread.id)} data-testid="wontfix-button"
							style={{ padding: '4px 12px', background: '#333', color: '#888', border: '1px solid #555', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
							Won't Fix
						</button>
					</>
				)}
				{thread.status === 'addressed' && (
					<button onClick={() => onReopen(thread.id)} data-testid="reopen-button"
						style={{ padding: '4px 12px', background: '#333', color: '#f44', border: '1px solid #555', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
						Reopen
					</button>
				)}
			</div>
		</div>
	)
}
