/**
 * exoWs — WebSocket-based exoeval RPC for provider UIs.
 *
 * Same protocol as exoRpc but over a persistent WebSocket connection.
 * Supports fire-and-forget (no id) and request/response (with id).
 */

type PendingCall = {
	resolve: (value: unknown) => void
	reject: (error: Error) => void
}

export class ExoWs {
	private ws: WebSocket | null = null
	private connectingWs: WebSocket | null = null
	private disposed = false
	private pending = new Map<number, PendingCall>()
	private queue: string[] = []
	private nextId = 1
	private providerName: string
	private connectPromise: Promise<void> | null = null

	constructor(providerName: string) {
		this.providerName = providerName
	}

	private connect(): Promise<void> {
		if (this.disposed) { return Promise.reject(new Error('disposed')) }
		if (this.ws?.readyState === WebSocket.OPEN) {
			return Promise.resolve()
		}
		if (this.connectPromise) {
			return this.connectPromise
		}

		this.connectPromise = new Promise<void>((resolve, reject) => {
			const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
			const ws = new WebSocket(`${protocol}//${this.providerName}.localhost:${window.location.port}/ws`)
			this.connectingWs = ws

			ws.onopen = () => {
				this.connectingWs = null
				if (this.disposed) { ws.close(); reject(new Error('disposed')); return }
				this.ws = ws
				this.connectPromise = null
				for (const code of this.queue) {
					ws.send(JSON.stringify({ code }))
				}
				this.queue.length = 0
				resolve()
			}

			ws.onerror = () => {
				this.connectPromise = null
				reject(new Error('WebSocket connection failed'))
			}

			ws.onclose = () => {
				this.ws = null
				this.connectPromise = null
				// Reject all pending calls
				for (const [, call] of this.pending) {
					call.reject(new Error('WebSocket closed'))
				}
				this.pending.clear()
			}

			ws.onmessage = (event) => {
				try {
					const msg = JSON.parse(event.data as string) as { id: number, result?: unknown, error?: string }
					const call = this.pending.get(msg.id)
					if (call) {
						this.pending.delete(msg.id)
						if (msg.error) {
							call.reject(new Error(msg.error))
						}
						else {
							call.resolve(msg.result)
						}
					}
				}
				catch { /* ignore malformed messages */ }
			}
		})

		return this.connectPromise
	}

	/** Fire-and-forget — no response expected. Queues until connected. */
	fire<Caps>(fn: (caps: Caps) => unknown, capture?: { [key: string]: unknown }): void {
		const code = this.buildCode(fn, capture)
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify({ code }))
		}
		else {
			this.queue.push(code)
			this.connect().catch(() => {})
		}
	}

	/** Request/response — returns a promise */
	async call<Caps>(fn: (caps: Caps) => unknown, capture?: { [key: string]: unknown }): Promise<unknown> {
		const code = this.buildCode(fn, capture)
		await this.connect()

		const id = this.nextId++
		return new Promise<unknown>((resolve, reject) => {
			this.pending.set(id, { resolve, reject })
			this.ws!.send(JSON.stringify({ id, code }))
		})
	}

	dispose(): void {
		this.disposed = true
		this.connectingWs?.close()
		this.connectingWs = null
		this.ws?.close()
		this.ws = null
		this.queue.length = 0
		for (const [, call] of this.pending) {
			call.reject(new Error('disposed'))
		}
		this.pending.clear()
	}

	private buildCode<Caps>(fn: (caps: Caps) => unknown, capture?: { [key: string]: unknown }): string {
		const fnSource = fn.toString()
		let prefix = ''
		if (capture) {
			for (const [key, value] of Object.entries(capture)) {
				prefix += `const ${key} = ${JSON.stringify(value)}; `
			}
		}
		return `${prefix}(${fnSource})({ ${this.providerName} })`
	}
}
