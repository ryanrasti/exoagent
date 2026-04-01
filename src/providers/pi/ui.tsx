import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import type { PiProviderImpl } from './index'
import { useEffect, useRef, useState } from 'react'
import { exoRpc } from '../../ui/lib/exoRpc'
import '@xterm/xterm/css/xterm.css'

type PiCaps = {
	pi: PiProviderImpl
}

type SessionInfo = {
	client: string
	sessionId: string
	cwd: string
	alive: boolean
}

export default function PiPanel() {
	const [sessions, setSessions] = useState<SessionInfo[]>([])
	const [activeSession, setActiveSession] = useState<{ client: string, sessionId: string } | null>(null)
	const [error, setError] = useState<string | null>(null)

	const loadSessions = async () => {
		try {
			const list = (await exoRpc<PiCaps>(({ pi }) => pi.list())) as SessionInfo[]
			setSessions(list)
			setError(null)
		}
		catch (e) {
			setError(String(e))
		}
	}

	useEffect(() => {
		loadSessions()
		const interval = setInterval(loadSessions, 3000)
		return () => clearInterval(interval)
	}, [])

	if (activeSession) {
		return (
			<TerminalView
				client={activeSession.client}
				sessionId={activeSession.sessionId}
				onBack={() => setActiveSession(null)}
			/>
		)
	}

	return (
		<div className="max-w-[800px] mx-auto my-8 px-4 font-sans text-gray-200">
			<div className="flex items-center gap-3 mb-6">
				<a href={`http://localhost:${window.location.port}/`} className="text-gray-500 hover:text-gray-300 transition-colors">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
				</a>
				<h1 className="text-xl m-0 font-bold text-gray-100">pi provider</h1>
			</div>

			{error && <div className="bg-red-900 border border-red-700 text-red-200 px-4 py-3 rounded mb-6">{error}</div>}

			{sessions.length === 0 && (
				<div className="bg-neutral-800 border border-neutral-700 rounded-lg p-5 text-gray-500 italic">
					No active agent sessions. Create one from an exo.
				</div>
			)}

			<div className="flex flex-col gap-2">
				{sessions.map(s => (
					<button
						key={`${s.client}:${s.sessionId}`}
						type="button"
						onClick={() => setActiveSession({ client: s.client, sessionId: s.sessionId })}
						className="bg-neutral-800 border border-neutral-700 rounded-lg p-4 text-left hover:border-neutral-600 transition-colors cursor-pointer w-full"
					>
						<div className="flex items-center justify-between">
							<div>
								<span className="text-blue-400 font-semibold">{s.client}</span>
								<span className="text-gray-500 mx-2">/</span>
								<span className="text-gray-300">{s.sessionId}</span>
							</div>
							<span className={`text-xs px-2 py-0.5 rounded ${s.alive ? 'bg-green-900 text-green-300' : 'bg-neutral-700 text-gray-500'}`}>
								{s.alive ? 'running' : 'exited'}
							</span>
						</div>
						<div className="text-xs text-gray-500 mt-1 font-mono">{s.cwd}</div>
					</button>
				))}
			</div>
		</div>
	)
}

const TerminalView = ({ client, sessionId, onBack }: { client: string, sessionId: string, onBack: () => void }) => {
	const termRef = useRef<HTMLDivElement>(null)
	const disposedRef = useRef(false)
	const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')

	useEffect(() => {
		disposedRef.current = false
		let term: Terminal | null = null
		let fitAddon: FitAddon | null = null

		const setup = async () => {
			const xtermMod = await import('@xterm/xterm')
			const fitMod = await import('@xterm/addon-fit')

			if (disposedRef.current || !termRef.current) { return }

			term = new xtermMod.Terminal({
				cursorBlink: true,
				fontSize: 13,
				fontFamily: 'JetBrains Mono, Fira Code, monospace',
				theme: {
					background: '#1a1a1a',
					foreground: '#e0e0e0',
					cursor: '#e0e0e0',
				},
			})

			fitAddon = new fitMod.FitAddon()
			term.loadAddon(fitAddon)
			term.open(termRef.current)
			fitAddon.fit()
			setStatus('connected')

			// Send resize to server
			const { cols, rows } = term
			exoRpc<PiCaps>(
				({ pi }) => pi.resize(client, sessionId, cols, rows),
				{ client, sessionId, cols, rows },
			).catch(() => {})

			// Handle resize
			const resizeObserver = new ResizeObserver(() => {
				if (fitAddon && term) {
					fitAddon.fit()
					exoRpc<PiCaps>(
						({ pi }) => pi.resize(client, sessionId, term!.cols, term!.rows),
						{ client, sessionId, cols: term.cols, rows: term.rows },
					).catch(() => {})
				}
			})
			resizeObserver.observe(termRef.current)

			// Input: send keystrokes to server
			term.onData((data: string) => {
				exoRpc<PiCaps>(
					({ pi }) => pi.input(client, sessionId, data),
					{ client, sessionId, data },
				).catch(() => {})
			})

			// Output: long-poll loop
			const poll = async () => {
				while (!disposedRef.current) {
					try {
						const data = await exoRpc<PiCaps>(
							({ pi }) => pi.read(client, sessionId),
							{ client, sessionId },
						)
						if (disposedRef.current || !term) { break }
						if (typeof data === 'string' && data.length > 0) {
							term.write(data)
						}
						else if (data === '') {
							// Session exited
							setStatus('disconnected')
							break
						}
					}
					catch {
						if (!disposedRef.current) {
							setStatus('disconnected')
						}
						break
					}
				}
			}
			poll()
		}

		setup()

		return () => {
			disposedRef.current = true
			term?.dispose()
		}
	}, [client, sessionId])

	return (
		<div className="h-screen flex flex-col bg-[#1a1a1a]">
			<div className="flex items-center gap-3 px-4 py-3 bg-neutral-900 border-b border-neutral-700">
				<button
					type="button"
					onClick={onBack}
					className="text-gray-500 hover:text-gray-300 transition-colors bg-transparent border-none cursor-pointer p-1"
				>
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
				</button>
				<span className="text-blue-400 font-semibold">{client}</span>
				<span className="text-gray-500">/</span>
				<span className="text-gray-300">{sessionId}</span>
				<span className={`text-xs px-2 py-0.5 rounded ml-auto ${
					status === 'connected'
						? 'bg-green-900 text-green-300'
						: status === 'connecting'
							? 'bg-yellow-900 text-yellow-300'
							: 'bg-neutral-700 text-gray-500'
				}`}
				>
					{status}
				</span>
			</div>
			<div ref={termRef} className="flex-1 p-1" />
		</div>
	)
}
