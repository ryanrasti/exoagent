import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

type ProviderInfo = {
	name: string
	hasUI: boolean
	clients: string[]
}

function Dashboard() {
	const [providers, setProviders] = useState<ProviderInfo[]>([])

	useEffect(() => {
		fetch('/api/providers')
			.then(r => r.json())
			.then((d: { providers: ProviderInfo[] }) => setProviders(d.providers))
	}, [])

	return (
		<div
			style={{
				maxWidth: 480,
				margin: '2rem auto',
				padding: '0 1rem',
				fontFamily: 'system-ui, sans-serif',
				color: '#e0e0e0',
				background: '#1a1a1a',
				minHeight: '100vh',
			}}
		>
			<h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>exoagent</h1>

			<h2 style={{ fontSize: '1rem', marginBottom: '0.5rem', color: '#aaa' }}>providers</h2>
			<ul style={{ listStyle: 'none', padding: 0 }}>
				{providers.map(p => (
					<li key={p.name} style={{ marginBottom: '0.75rem' }}>
						{p.hasUI
							? (
								<a
									href={`http://${p.name}.localhost:${window.location.port}/`}
									style={{ color: '#6af', textDecoration: 'none' }}
								>
									{p.name}
								</a>
							)
							: (
								<span style={{ color: '#888' }}>{p.name}</span>
							)}
						{p.clients.length > 0 && (
							<span style={{ color: '#666', fontSize: '0.8rem', marginLeft: '0.5rem' }}>
								→
								{' '}
								{p.clients.join(', ')}
							</span>
						)}
					</li>
				))}
			</ul>
		</div>
	)
}

// Self-mounting: this file is loaded directly by the server template
createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<Dashboard />
	</StrictMode>,
)
