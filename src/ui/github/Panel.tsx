import { useState } from 'react'

const API_BASE = '/api/github'

async function rpc(expr: string): Promise<unknown> {
	const res = await fetch(API_BASE, { method: 'POST', body: expr })
	if (!res.ok) {
		throw new Error(await res.text())
	}
	return res.json()
}

export function GitHubPanel() {
	const [token, setToken] = useState('')
	const [status, setStatus] = useState<{ type: 'idle' | 'ok' | 'error'; message: string }>({
		type: 'idle',
		message: '',
	})
	const [user, setUser] = useState<{ login: string; id: number; name: string | null } | null>(null)

	async function saveToken() {
		try {
			await rpc(`github.setToken("${token.replace(/"/g, '\\"')}")`)
			setStatus({ type: 'ok', message: 'token saved' })
		} catch (err) {
			setStatus({ type: 'error', message: err instanceof Error ? err.message : String(err) })
		}
	}

	async function testConnection() {
		setStatus({ type: 'idle', message: 'testing...' })
		setUser(null)
		try {
			const result = await rpc('github.testConnection()') as { login: string; id: number; name: string | null }
			setUser(result)
			setStatus({ type: 'ok', message: `connected as ${result.login}` })
		} catch (err) {
			setStatus({ type: 'error', message: err instanceof Error ? err.message : String(err) })
		}
	}

	return (
		<div style={{ maxWidth: 480, margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif', color: '#e0e0e0', background: '#1a1a1a', minHeight: '100vh' }}>
			<h1 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>github provider</h1>

			<input
				type="password"
				placeholder="GitHub Personal Access Token"
				value={token}
				onChange={(e) => setToken(e.target.value)}
				style={{ width: '100%', padding: '0.4rem 0.6rem', marginBottom: '0.5rem', background: '#222', color: '#e0e0e0', border: '1px solid #444', borderRadius: 3, fontFamily: 'monospace', boxSizing: 'border-box' }}
			/>

			<div>
				<button onClick={saveToken} style={btnStyle}>save token</button>
				<button onClick={testConnection} style={btnStyle}>test connection</button>
			</div>

			{status.message && (
				<div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: status.type === 'ok' ? '#6c6' : status.type === 'error' ? '#e55' : '#aaa' }}>
					{status.message}
				</div>
			)}

			{user && (
				<pre style={{ background: '#222', padding: '0.8rem', borderRadius: 3, marginTop: '1rem', whiteSpace: 'pre-wrap', fontSize: '0.85rem', overflow: 'auto' }}>
					{JSON.stringify(user, null, 2)}
				</pre>
			)}
		</div>
	)
}

const btnStyle: React.CSSProperties = {
	cursor: 'pointer',
	background: '#333',
	color: '#e0e0e0',
	border: '1px solid #444',
	padding: '0.4rem 0.8rem',
	borderRadius: 3,
	marginRight: '0.5rem',
}
