import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'

type ProviderInfo = {
	name: string
	shortName: string
	hasUI: boolean
	clients: string[]
}

const formatUptime = (ms: number): string => {
	const seconds = Math.floor(ms / 1000)
	if (seconds < 60) { return `${seconds}s` }
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) { return `${minutes}m ${seconds % 60}s` }
	const hours = Math.floor(minutes / 60)
	return `${hours}h ${minutes % 60}m`
}

function Dashboard() {
	const [providers, setProviders] = useState<ProviderInfo[]>([])
	const [health, setHealth] = useState<{ bootMs: number, startedAt: number } | null>(null)
	const [uptime, setUptime] = useState('')

	useEffect(() => {
		fetch('/api/providers')
			.then(r => r.json())
			.then((d: { providers: ProviderInfo[] }) => setProviders(d.providers))
		fetch('/health')
			.then(r => r.json())
			.then((d: { bootMs: number, startedAt: number }) => setHealth(d))
	}, [])

	useEffect(() => {
		if (!health) { return }
		const tick = () => setUptime(formatUptime(Date.now() - health.startedAt))
		tick()
		const interval = setInterval(tick, 1000)
		return () => clearInterval(interval)
	}, [health])

	const sortedProviders = providers // The backend already sends them topo sorted!

	return (
		<div className="max-w-[600px] mx-auto my-8 px-4 font-sans text-gray-200">
			<div className="flex items-center gap-3 mb-8">
				<img src="/assets/logo.svg" alt="logo" className="w-8 h-8" />
				<h1 className="text-2xl m-0 font-bold">exoagent</h1>
				{health && (
					<div className="ml-auto text-xs text-gray-500 font-mono">
						<span title={`boot: ${health.bootMs}ms`}>
							up
							{uptime}
						</span>
					</div>
				)}
			</div>

			<h2 className="text-base mb-4 text-gray-400 font-semibold">providers</h2>

			<div className="flex flex-col gap-2">
				{sortedProviders.map(p => (
					<div
						key={p.name}
						className="bg-neutral-800 border border-neutral-700 rounded-lg p-4 transition-colors hover:border-neutral-600"
					>
						<div className="flex items-center justify-between">
							{p.hasUI
								? (
									<a
										href={`http://${p.shortName}.localhost:${window.location.port}/`}
										className="text-blue-400 hover:text-blue-300 no-underline font-semibold text-lg"
									>
										{p.shortName}
									</a>
								)
								: (
									<span className="text-gray-500 font-semibold text-lg">{p.shortName}</span>
								)}
							<span className="text-xs text-gray-600 font-mono">{p.name}</span>
						</div>

						{p.clients.length > 0 && (
							<div className="mt-3">
								<div className="text-xs text-gray-500 mb-1">used by:</div>
								<div className="flex gap-2 flex-wrap">
									{p.clients.sort().map(client => (
										<span key={client} className="bg-neutral-700 px-2 py-0.5 rounded text-sm text-gray-300">
											{client}
										</span>
									))}
								</div>
							</div>
						)}
					</div>
				))}
			</div>
		</div>
	)
}

// Self-mounting: this file is loaded directly by the server template
createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<Dashboard />
	</StrictMode>,
)
