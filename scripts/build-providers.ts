import type { BuildOptions } from 'esbuild'
import { readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const srcDir = resolve(process.cwd(), 'src/providers')
const distDir = resolve(process.cwd(), 'dist/providers')

const providers = readdirSync(srcDir).filter((entry) => {
	const stat = statSync(resolve(srcDir, entry))
	return stat.isDirectory()
})

const isWatch = process.argv.includes('--watch')

console.log(`Building ${providers.length} providers...`)

const buildProvider = async (name: string) => {
	const entryPath = resolve(srcDir, name, 'index.ts')
	const outPath = resolve(distDir, name, 'index.js')

	const options: BuildOptions = {
		entryPoints: [entryPath],
		outfile: outPath,
		bundle: true,
		format: 'esm',
		target: 'es2022',
		// We don't mark zod as external so esbuild inlines it into the bundle.
		// Native modules and heavy db bindings stay external but are bridged or passed via ring0.
		external: ['node:*', 'better-sqlite3', 'node-pty', '@mariozechner/pi-coding-agent'],
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

Promise.all(providers.map(buildProvider))
	.then(() => {
		if (isWatch) {
			console.log('Watching for changes in providers...')
		}
		else {
			console.log('Finished building providers.')
		}
	})
	.catch((err) => {
		console.error('Failed to build providers:', err)
		process.exit(1)
	})
