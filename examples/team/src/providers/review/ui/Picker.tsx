/**
 * Picker — create a new review.
 * Select an agent, enter a git ref, create.
 */

import { useState, useEffect } from 'react'
import { exoRpc } from './rpc'
import type { ReviewProviderImpl } from '../index'

type ReviewCaps = { review: ReviewProviderImpl }
type Agent = { client: string, sessionId: string, alive: boolean }

export const Picker = ({ onCreated }: { onCreated: (reviewId: string) => void }) => {
	const [agents, setAgents] = useState<Agent[]>([])
	const [selectedAgent, setSelectedAgent] = useState('')
	const [ref, setRef] = useState('HEAD')
	const [repoRoot, setRepoRoot] = useState('')
	const [error, setError] = useState('')
	const [creating, setCreating] = useState(false)

	useEffect(() => {
		exoRpc<ReviewCaps>(({ review }) => review.listAgents())
			.then((result: any) => {
				const agentList = result as Agent[]
				setAgents(agentList)
				if (agentList.length > 0) {
					setSelectedAgent(`${agentList[0].client}:${agentList[0].sessionId}`)
				}
			})
			.catch((err: Error) => setError(err.message))
	}, [])

	const handleCreate = async () => {
		setError('')
		setCreating(true)
		try {
			const [client, sessionId] = selectedAgent.split(':')
			const opts = {
				ref,
				repoRoot: repoRoot || '.',
				agent: client && sessionId ? { client, sessionId } : undefined,
			}
			const result = await exoRpc<ReviewCaps>(
				({ review }) => review.create(opts),
				{ opts },
			)
			onCreated((result as any).id)
		}
		catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		}
		finally {
			setCreating(false)
		}
	}

	return (
		<div style={{ padding: 20, maxWidth: 500 }}>
			<h2 style={{ marginTop: 0 }}>New Code Review</h2>

			<div style={{ marginBottom: 16 }}>
				<label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold' }}>
					Git Ref
				</label>
				<input
					type="text"
					value={ref}
					onChange={e => setRef(e.target.value)}
					placeholder="HEAD"
					data-testid="ref-input"
					style={{
						width: '100%',
						padding: '8px 12px',
						background: '#2a2a2a',
						border: '1px solid #444',
						borderRadius: 4,
						color: '#e0e0e0',
						fontSize: 14,
						boxSizing: 'border-box',
					}}
				/>
			</div>

			<div style={{ marginBottom: 16 }}>
				<label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold' }}>
					Repo Root
				</label>
				<input
					type="text"
					value={repoRoot}
					onChange={e => setRepoRoot(e.target.value)}
					placeholder="(auto-detect from EXOAGENT_DIR)"
					data-testid="repo-input"
					style={{
						width: '100%',
						padding: '8px 12px',
						background: '#2a2a2a',
						border: '1px solid #444',
						borderRadius: 4,
						color: '#e0e0e0',
						fontSize: 14,
						boxSizing: 'border-box',
					}}
				/>
			</div>

			<div style={{ marginBottom: 16 }}>
				<label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold' }}>
					Agent
				</label>
				<select
					value={selectedAgent}
					onChange={e => setSelectedAgent(e.target.value)}
					data-testid="agent-select"
					style={{
						width: '100%',
						padding: '8px 12px',
						background: '#2a2a2a',
						border: '1px solid #444',
						borderRadius: 4,
						color: '#e0e0e0',
						fontSize: 14,
					}}
				>
					<option value="">None (no agent)</option>
					{agents.map(a => (
						<option key={`${a.client}:${a.sessionId}`} value={`${a.client}:${a.sessionId}`}>
							{a.client}/{a.sessionId} {a.alive ? '●' : '○'}
						</option>
					))}
				</select>
			</div>

			{error && (
				<div style={{ color: '#f44', marginBottom: 16 }} data-testid="error-message">
					{error}
				</div>
			)}

			<button
				onClick={handleCreate}
				disabled={creating}
				data-testid="create-button"
				style={{
					padding: '10px 20px',
					background: '#4a9eff',
					color: '#fff',
					border: 'none',
					borderRadius: 4,
					fontSize: 14,
					cursor: creating ? 'wait' : 'pointer',
					opacity: creating ? 0.7 : 1,
				}}
			>
				{creating ? 'Creating...' : 'Create Review'}
			</button>
		</div>
	)
}
