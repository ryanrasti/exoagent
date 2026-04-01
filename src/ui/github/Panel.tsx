import type { GitHubProviderImpl } from '../../providers/github'
import { useEffect, useState } from 'react'
import { exoRpc } from '../lib/exoRpc'

type GitHubCaps = {
	github: GitHubProviderImpl
}

export default function GitHubPanel() {
	const [token, setToken] = useState('')
	const [visibleToken, setVisibleToken] = useState(false)
	const [status, setStatus] = useState<{ type: 'idle' | 'ok' | 'error', message: string }>({
		type: 'idle',
		message: '',
	})
	const [user, setUser] = useState<{ login: string, id: number, name: string | null } | null>(
		null,
	)

	useEffect(() => {
		exoRpc<GitHubCaps>(({ github }) => github.getToken()).then((t) => {
			if (typeof t === 'string') {
				setToken(t)
			}
		}).catch(() => {})
	}, [])

	async function saveToken() {
		try {
			await exoRpc<GitHubCaps>(({ github }) => github.setToken(token), { token })
			setStatus({ type: 'ok', message: 'token saved' })
		}
		catch (err) {
			setStatus({ type: 'error', message: err instanceof Error ? err.message : String(err) })
		}
	}

	async function testConnection() {
		setStatus({ type: 'idle', message: 'testing...' })
		setUser(null)
		try {
			const result = (await exoRpc<GitHubCaps>(
				({ github }) => github.testConnection(),
			)) as { login: string, id: number, name: string | null }
			setUser(result)
			setStatus({ type: 'ok', message: `connected as ${result.login}` })
		}
		catch (err) {
			setStatus({ type: 'error', message: err instanceof Error ? err.message : String(err) })
		}
	}

	return (
		<div className="max-w-[480px] mx-auto my-8 px-4 font-sans text-gray-200">
			<div className="flex items-center gap-3 mb-6">
				<a href={`http://localhost:${window.location.port}/`} className="text-gray-500 hover:text-gray-300 transition-colors">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
				</a>
				<h1 className="text-xl m-0 font-bold text-gray-100">github provider</h1>
			</div>

			<div className="bg-neutral-800 border border-neutral-700 rounded-lg p-5">
				<p className="text-sm text-gray-400 mb-4">
					You need a GitHub Personal Access Token (classic) with at least the
					{' '}
					<code>repo</code>
					{' '}
					and
					{' '}
					<code>read:user</code>
					{' '}
					scopes.
					<br />
					<a
						href="https://github.com/settings/tokens/new"
						target="_blank"
						rel="noreferrer"
						className="text-blue-400 hover:text-blue-300 underline"
					>
						Create one here
					</a>
					.
				</p>

				<div className="relative mb-4">
					<input
						type={visibleToken ? 'text' : 'password'}
						placeholder="GitHub Personal Access Token"
						value={token}
						onChange={e => setToken(e.target.value)}
						className="w-full px-3 py-2 pr-10 bg-neutral-900 text-gray-200 border border-neutral-600 rounded focus:border-blue-500 focus:outline-none font-mono text-sm"
					/>
					<button
						type="button"
						className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 cursor-pointer bg-transparent border-none p-1 flex items-center justify-center"
						onClick={() => setVisibleToken(v => !v)}
						title={visibleToken ? 'Hide token' : 'Show token'}
					>
						{visibleToken
							? (
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
									<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
									<line x1="1" y1="1" x2="23" y2="23" />
								</svg>
							)
							: (
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
									<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
									<circle cx="12" cy="12" r="3" />
								</svg>
							)}
					</button>
				</div>

				<div className="flex gap-2">
					<button
						type="button"
						onClick={saveToken}
						className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium transition-colors border-none cursor-pointer text-sm"
					>
						save token
					</button>
					<button
						type="button"
						onClick={testConnection}
						className="px-4 py-2 bg-neutral-700 hover:bg-neutral-600 text-white rounded font-medium transition-colors border border-neutral-600 cursor-pointer text-sm"
					>
						test connection
					</button>
				</div>

				{status.message && (
					<div className={`mt-4 text-sm font-medium ${
						status.type === 'ok'
							? 'text-green-400'
							: status.type === 'error'
								? 'text-red-400'
								: 'text-gray-400'
					}`}
					>
						{status.message}
					</div>
				)}

				{user && (
					<pre className="mt-4 bg-neutral-900 p-4 rounded border border-neutral-700 overflow-auto text-xs text-gray-300">
						{JSON.stringify(user, null, 2)}
					</pre>
				)}
			</div>
		</div>
	)
}
