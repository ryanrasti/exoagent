/**
 * PtySession — manages a single PTY process with a screen buffer.
 *
 * Like a mini tmux: PTY output feeds a headless xterm (screen state).
 * Clients connect, get the current screen via serialize(), then
 * receive live updates via waiters (long-poll broadcast).
 */

type PtyProcess = {
	onData: (cb: (data: string) => void) => void
	onExit: (cb: () => void) => void
	write: (data: string) => void
	resize: (cols: number, rows: number) => void
	kill: () => void
}

export type PtySessionInfo = {
	client: string
	sessionId: string
	cwd: string
	alive: boolean
}

export class PtySession {
	readonly client: string
	readonly sessionId: string
	readonly cwd: string
	alive = true

	private readonly pty: PtyProcess
	private readonly screen: any // HeadlessTerminal with serialize()
	private waiters: Array<(data: string) => void> = []

	constructor(opts: {
		client: string
		sessionId: string
		cwd: string
		pty: PtyProcess
		screen: any
	}) {
		this.client = opts.client
		this.sessionId = opts.sessionId
		this.cwd = opts.cwd
		this.pty = opts.pty
		this.screen = opts.screen

		this.pty.onData((data) => {
			this.screen.write(data)
			const w = this.waiters
			this.waiters = []
			for (const resolve of w) { resolve(data) }
		})

		this.pty.onExit(() => {
			this.alive = false
			const w = this.waiters
			this.waiters = []
			for (const resolve of w) { resolve('') }
		})
	}

	/** Current screen state with ANSI codes — for initial render on connect. */
	serialize(): string {
		return this.screen.serialize()
	}

	/** Wait for next output. All callers get the same data (broadcast). */
	read(): Promise<string> {
		if (!this.alive) { return Promise.resolve('') }
		return new Promise(resolve => this.waiters.push(resolve))
	}

	/** Send input to the PTY. */
	write(data: string): void {
		if (!this.alive) { return }
		this.pty.write(data)
	}

	/** Resize PTY and screen buffer. */
	resize(cols: number, rows: number): void {
		if (!this.alive) { return }
		this.pty.resize(cols, rows)
		this.screen.resize(cols, rows)
	}

	/** Kill the PTY process. */
	kill(): void {
		if (this.alive) { this.pty.kill() }
	}

	info(): PtySessionInfo {
		return {
			client: this.client,
			sessionId: this.sessionId,
			cwd: this.cwd,
			alive: this.alive,
		}
	}
}
