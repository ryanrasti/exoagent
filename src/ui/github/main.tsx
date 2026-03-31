import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { GitHubPanel } from './Panel'

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<GitHubPanel />
	</StrictMode>,
)
