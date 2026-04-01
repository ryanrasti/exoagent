/**
 * Generic provider UI mount point.
 *
 * Reads the provider name from <meta name="x-provider">,
 * dynamically imports the Panel component, and mounts it.
 * Eliminates per-provider index.html + main.tsx boilerplate.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const providerName = document.querySelector('meta[name="x-provider"]')?.getAttribute('content')

if (!providerName) {
	document.getElementById('root')!.textContent = 'error: no provider name in page meta'
}
else {
	// Dynamic import of the provider's Panel component
	// Vite handles this via glob or explicit dynamic import
	const panels: { [name: string]: () => Promise<{ default: React.ComponentType }> } = {
		github: () => import('./github/Panel'),
		config: () => import('./config/Panel'),
		pi: () => import('./pi/Panel'),
	}

	const loader = panels[providerName]
	if (!loader) {
		document.getElementById('root')!.textContent = `error: no UI panel for provider "${providerName}"`
	}
	else {
		loader().then(({ default: Panel }) => {
			createRoot(document.getElementById('root')!).render(
				<StrictMode>
					<Panel />
				</StrictMode>,
			)
		})
	}
}
