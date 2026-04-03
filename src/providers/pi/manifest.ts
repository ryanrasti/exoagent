/**
 * Pi provider — ring0 for pi SDK, node-pty, and IPC.
 *
 * No config dependency for v0 — pi manages its own API keys
 * via ~/.pi/agent/auth.json and ANTHROPIC_API_KEY env var.
 */

import type { LogProviderImpl } from '../log'

export default {
	'ring0': async () => {
		const pty = await import('node-pty')
		const path = await import('node:path')
		const os = await import('node:os')
		const fs = await import('node:fs')
		const net = await import('node:net')
		const RawDatabase = (await import('better-sqlite3')).default

		const Database = (path: string) => new RawDatabase(path) as unknown
		const { default: XtermHeadless } = await import('@xterm/headless') as any
		const { SerializeAddon } = await import('@xterm/addon-serialize')
		const createScreen = (cols: number, rows: number) => {
			const t = new XtermHeadless.Terminal({ cols, rows })
			const s = new SerializeAddon()
			t.loadAddon(s)
			return {
				write: (data: string) => t.write(data),
				resize: (c: number, r: number) => t.resize(c, r),
				serialize: () => s.serialize(),
			}
		}
		const { BoundEval } = await import('exoagent/bound-eval')
		return {
			pty: { spawn: (cmd: string, args: string[], opts: any) => pty.spawn(cmd, args, opts) },
			resolve: (...args: any[]) => path.resolve(...args),
			join: (...args: any[]) => path.join(...args),

			homedir: () => os.homedir(),
			mkdirSync: (...args: any[]) => (fs.mkdirSync as any)(...args),
			readFileSync: (p: string, enc: string) => fs.readFileSync(p, enc as BufferEncoding) as unknown as string,
			unlinkSync: (p: string) => fs.unlinkSync(p),
			createServer: (...args: any[]) => net.createServer(...args),
			Database,
			BoundEval,
			now: () => Date.now(),
			createScreen,
		}
	},
	'@exoagent/providers/log': (log: LogProviderImpl) => log as unknown,
}
