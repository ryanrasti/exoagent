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
			pty,
			resolve: path.resolve,
			join: path.join,
			dirname: path.dirname(import.meta.filename),
			homedir: os.homedir,
			mkdirSync: fs.mkdirSync,
			unlinkSync: fs.unlinkSync,
			createServer: net.createServer,
		}
	},
}
