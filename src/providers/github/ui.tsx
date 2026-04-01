import type { GitHubProviderImpl } from './index'
import { useState } from 'react'
import { exoRpc } from '../../ui/lib/exoRpc'

type GitHubCaps = {
	github: GitHubProviderImpl
}

export default function GitHubPanel() {
	const [status, setStatus] = useState<{ type: 'idle' | 'ok' | 'error', message: string }>({
		type: 'idle',
		message: '',
	})
	const [user, setUser] = useState<{ login: string, id: number, name: string | null } | null>(null)

	const testConnection = async () => {
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
					Token is managed via the
					{' '}
					<a href={`http://localhost:${window.location.port}/providers/config`} className="text-blue-400 hover:text-blue-300 underline">config provider</a>.
				</p>

				<button
					type="button"
					onClick={testConnection}
					className="px-4 py-2 bg-neutral-700 hover:bg-neutral-600 text-white rounded font-medium transition-colors border border-neutral-600 cursor-pointer text-sm"
				>
					test connection
				</button>

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
