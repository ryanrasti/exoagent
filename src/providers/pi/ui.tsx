// UI receives PiUiProvider (not ScopedPi) — has client param on all methods
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { Terminal } from '@xterm/xterm'
import { useEffect, useRef, useState } from 'react'
import { exoRpc } from '../../ui/lib/exoRpc'
import { ExoWs } from '../../ui/lib/exoWs'
import '@xterm/xterm/css/xterm.css'

type PiUi = {
	list: () => { client: string, sessionId: string, cwd: string, alive: boolean }[]
	input: (client: string, sessionId: string, data: string) => { ok: true }
	read: (client: string, sessionId: string) => Promise<string>
	resize: (client: string, sessionId: string, cols: number, rows: number) => { ok: true }
}

type PiCaps = {
	pi: PiUi
}

type SessionInfo = {
	client: string
	sessionId: string
	cwd: string
	alive: boolean
}

/** Parse hash route: #/pi/{client}/{sessionId} — client is URI-encoded */
const parseRoute = (): { client: string, sessionId: string } | null => {
	const match = window.location.hash.match(/^#\/pi\/([^/]+)\/(.+)$/)
	return match ? { client: decodeURIComponent(match[1]), sessionId: decodeURIComponent(match[2]) } : null
}

export default function PiPanel() {
	const [sessions, setSessions] = useState<SessionInfo[]>([])
	const [route, setRoute] = useState(parseRoute)
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

		const onHashChange = () => setRoute(parseRoute())
		window.addEventListener('hashchange', onHashChange)

		return () => {
			clearInterval(interval)
			window.removeEventListener('hashchange', onHashChange)
		}
	}, [])

	if (route) {
		return (
			<TerminalView
				client={route.client}
				sessionId={route.sessionId}
				onBack={() => {
					window.location.hash = ''
					setRoute(null)
				}}
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
						onClick={() => {
							window.location.hash = `#/pi/${encodeURIComponent(s.client)}/${encodeURIComponent(s.sessionId)}`
							setRoute({ client: s.client, sessionId: s.sessionId })
						}}
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
	const [status, setStatus] = useState<'connecting' | 'connected' | 'exited'>('connecting')

	useEffect(() => {
		disposedRef.current = false
		let term: Terminal | null = null
		let fitAddon: FitAddon | null = null
		let ro: ResizeObserver | null = null
		const ws = new ExoWs('pi')

		const setup = async () => {
			if (disposedRef.current || !termRef.current) { return }

			term = new Terminal({
				cursorBlink: true,
				fontSize: 13,
				fontFamily: 'JetBrains Mono, Fira Code, monospace',
				theme: {
					background: '#1a1a1a',
					foreground: '#e0e0e0',
					cursor: '#e0e0e0',
				},
				rightClickSelectsWord: true,
				allowProposedApi: true,
			})

			fitAddon = new FitAddon()
			const unicodeAddon = new Unicode11Addon()
			term.loadAddon(fitAddon)
			term.loadAddon(unicodeAddon)
			term.unicode.activeVersion = '11'
			term.open(termRef.current)

			let fitting = false
			let fitTimer: ReturnType<typeof setTimeout> | null = null
			ro = new ResizeObserver(() => {
				if (fitting) { return }
				if (fitTimer) { clearTimeout(fitTimer) }
				fitTimer = setTimeout(() => {
					fitting = true
					fitAddon?.fit()
					fitting = false
				}, 50)
			})
			ro.observe(termRef.current)

			term.onSelectionChange(() => {
				const selection = term?.getSelection()
				if (selection) {
					navigator.clipboard.writeText(selection).catch(() => {})
				}
			})

			// Send current size (no forced redraw — per-reader queues
			// ensure we get all future output from this point)
			const { cols, rows } = term
			await ws.call<PiCaps>(({ pi }) => pi.resize(client, sessionId, cols, rows), { client, sessionId, cols, rows })

			term.onResize(({ cols: c, rows: r }) => {
				ws.call<PiCaps>(({ pi }) => pi.resize(client, sessionId, c, r), { client, sessionId, c, r })
			})

			term.onData((data: string) => {
				ws.call<PiCaps>(({ pi }) => pi.input(client, sessionId, data), { client, sessionId, data })
			})

			// Long-poll for new output — all connected tabs receive broadcasts
			const poll = async () => {
				while (!disposedRef.current) {
					try {
						const data = await ws.call<PiCaps>(
							({ pi }) => pi.read(client, sessionId),
							{ client, sessionId },
						)
						if (disposedRef.current || !term) { break }
						if (typeof data === 'string' && data.length > 0) {
							setStatus('connected')
							term.write(data)
						}
						else if (data === '') {
							setStatus('exited')
							break
						}
					}
					catch {
						if (!disposedRef.current) {
							await new Promise(r => setTimeout(r, 1000))
						}
					}
				}
			}
			poll()
		}

		setup()

		return () => {
			disposedRef.current = true
			ro?.disconnect()
			ws.dispose()
			term?.dispose()
		}
	}, [client, sessionId])

	return (
		<div className="fixed inset-0 flex flex-col bg-[#1a1a1a]">
			<div className="flex-none flex items-center gap-3 px-4 py-3 bg-neutral-900 border-b border-neutral-700">
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
							: 'bg-red-900 text-red-300'
				}`}
				>
					{status}
				</span>
			</div>
			<div className="relative flex-1 min-h-0 overflow-hidden">
				<div ref={termRef} className="absolute inset-0 overflow-hidden" />
			</div>
		</div>
	)
}
