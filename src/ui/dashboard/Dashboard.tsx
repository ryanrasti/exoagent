import { useEffect, useState } from 'react'

export function Dashboard() {
	const [providers, setProviders] = useState<string[]>([])

	useEffect(() => {
		fetch('/api/providers')
			.then((r) => r.json())
			.then((d: { providers: string[] }) => setProviders(d.providers))
	}, [])

	return (
		<div style={{ maxWidth: 480, margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif', color: '#e0e0e0', background: '#1a1a1a', minHeight: '100vh' }}>
			<h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>exoagent</h1>

			<h2 style={{ fontSize: '1rem', marginBottom: '0.5rem', color: '#aaa' }}>providers</h2>
			<ul style={{ listStyle: 'none', padding: 0 }}>
				{providers.map((name) => (
					<li key={name} style={{ marginBottom: '0.5rem' }}>
						<a
							href={`http://${name}.localhost:${window.location.port}/`}
							style={{ color: '#6af', textDecoration: 'none' }}
						>
							{name}
						</a>
					</li>
				))}
			</ul>
		</div>
	)
}
