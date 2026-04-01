/**
 * Pi provider — ring0 for pi SDK, node-pty, and IPC.
 *
 * No config dependency for v0 — pi manages its own API keys
 * via ~/.pi/agent/auth.json and ANTHROPIC_API_KEY env var.
 */

export default {
	ring0: async () => {
		const pty = await import('node-pty')
		const path = await import('node:path')
		const os = await import('node:os')
		const fs = await import('node:fs')
		const net = await import('node:net')
		return {
			pty: { spawn: pty.spawn },
			resolve: path.resolve,
			join: path.join,

			homedir: os.homedir,
			mkdirSync: fs.mkdirSync,
			readFileSync: fs.readFileSync as (path: string, encoding: 'utf-8') => string,
			unlinkSync: fs.unlinkSync,
			createServer: net.createServer,
		}
	},
}
