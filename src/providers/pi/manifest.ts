/**
 * Pi provider — ring0 for pi SDK and node-pty.
 *
 * No config dependency for v0 — pi manages its own API keys
 * via ~/.pi/agent/auth.json and ANTHROPIC_API_KEY env var.
 */

export default {
	ring0: async () => {
		const piSdk = await import('@mariozechner/pi-coding-agent')
		const pty = await import('node-pty')
		const path = await import('node:path')
		const os = await import('node:os')
		const fs = await import('node:fs')
		return { piSdk, pty, resolve: path.resolve, join: path.join, homedir: os.homedir, mkdirSync: fs.mkdirSync }
	},
}
