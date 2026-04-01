import type { BuildOptions } from 'esbuild'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const isWatch = process.argv.includes('--watch')

// Bundle shared deps (zod) into dist/shared/ — parsed once by SES at boot
const buildShared = async () => {
	await build({
		entryPoints: [resolve(process.cwd(), 'node_modules/zod/index.js')],
		outfile: resolve(process.cwd(), 'dist/shared/zod.js'),
		bundle: true,
		format: 'esm',
		target: 'es2022',
		logLevel: 'info',
	})
}

const scanModules = (srcDir: string, distDir: string): { name: string, entry: string, out: string }[] => {
	if (!existsSync(srcDir)) { return [] }
	const modules: { name: string, entry: string, out: string }[] = []
	for (const entry of readdirSync(srcDir)) {
		const dir = resolve(srcDir, entry)
		if (!statSync(dir).isDirectory()) { continue }
		const indexPath = resolve(dir, 'index.ts')
		if (!existsSync(indexPath)) { continue }
		modules.push({ name: entry, entry: indexPath, out: resolve(distDir, entry, 'index.js') })
	}
	return modules
}

const modules = [
	...scanModules(resolve(process.cwd(), 'src/providers'), resolve(process.cwd(), 'dist/providers')),
	...scanModules(resolve(process.cwd(), 'examples'), resolve(process.cwd(), 'dist/examples')),
]

console.log(`Building ${modules.length} modules...`)

const buildModule = async (mod: { name: string, entry: string, out: string }) => {
	const options: BuildOptions = {
		entryPoints: [mod.entry],
		outfile: mod.out,
		bundle: true,
		format: 'esm',
		target: 'es2022',
		// We don't mark zod as external so esbuild inlines it into the bundle.
		// Native modules and heavy db bindings stay external but are bridged or passed via ring0.
		external: ['node:*', 'better-sqlite3', 'node-pty', '@mariozechner/pi-coding-agent', 'zod'],
		logLevel: 'info',
	}

	if (isWatch) {
		const ctx = await import('esbuild').then(m => m.context(options))
		await ctx.watch()
	}
	else {
		await build(options)
	}
}

Promise.all([buildShared(), ...modules.map(buildModule)])
	.then(() => {
		if (isWatch) {
			console.log('Watching for changes...')
		}
		else {
			console.log('Finished building modules.')
		}
	})
	.catch((err) => {
		console.error('Failed to build:', err)
		process.exit(1)
	})
