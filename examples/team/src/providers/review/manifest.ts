import type { PiProviderImpl } from 'exoagent/providers/pi'

export default {
	'ring0': async () => {
		const path = await import('node:path')
		const fs = await import('node:fs')
		const cp = await import('node:child_process')
		const RawDatabase = (await import('better-sqlite3')).default
		const diffLib = await import('diff')

		const Database = (dbPath: string) => new RawDatabase(dbPath) as unknown
		return {
			Database,
			mkdirSync: (...args: any[]) => (fs.mkdirSync as any)(...args),
			readFileSync: (p: string, enc: string) => fs.readFileSync(p, enc as BufferEncoding) as unknown as string,
			join: (...args: any[]) => path.join(...args),
			resolve: (...args: any[]) => path.resolve(...args),
			relative: (...args: any[]) => path.relative(...args),
			execSync: (cmd: string, opts: any) => cp.execSync(cmd, opts),
			createPatch: diffLib.createPatch,
		}
	},
	'@exoagent/providers/pi': (pi: PiProviderImpl) => pi,
}
