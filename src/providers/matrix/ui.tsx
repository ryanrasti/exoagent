import type { MatrixProviderImpl } from './index'
import { useEffect, useState } from 'react'
import { exoRpc } from '../../ui/lib/exoRpc'

type MatrixCaps = {
	matrix: MatrixProviderImpl
}

export default function MatrixPanel() {
	const [userId, setUserId] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		exoRpc<MatrixCaps>(({ matrix }) => matrix.whoami())
			.then((v) => { setUserId((v as { user_id: string }).user_id) })
			.catch((e) => { setError(e instanceof Error ? e.message : String(e)) })
	}, [])

	return (
		<div className="max-w-[600px] mx-auto my-8 px-4 font-sans text-gray-200">
			<div className="flex items-center gap-3 mb-6">
				<a href={`http://localhost:${window.location.port}/`} className="text-gray-500 hover:text-gray-300 transition-colors">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
				</a>
				<h1 className="text-xl m-0 font-bold text-gray-100">matrix provider</h1>
			</div>

			{error && <div className="bg-red-900 border border-red-700 text-red-200 px-4 py-3 rounded mb-6">{error}</div>}

			<div className="bg-neutral-800 border border-neutral-700 rounded-lg p-5">
				<p className="text-sm text-gray-400 mb-4">
					Configure your Matrix connection in the
					{' '}
					<a href={`http://config.localhost:${window.location.port}/`} className="text-blue-400 hover:text-blue-300 underline">config provider</a>
					.
				</p>
				<p className="text-xs text-gray-500 mb-4">
					Setup: Create a Matrix account (e.g., on matrix.org via Element), get your access token
					from Element → Settings → Help &amp; About, create a private room, and enter the details in config.
				</p>

				{userId && (
					<div className="mt-4 text-sm">
						<span className="text-gray-400">Connected as:</span>
						{' '}
						<span className="text-green-400 font-semibold">{userId}</span>
					</div>
				)}
			</div>
		</div>
	)
}
