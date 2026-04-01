/**
 * Pi agent worker — runs inside a PTY subprocess.
 *
 * Receives custom tool config via IPC (unix domain socket).
 * Creates an AgentSession with those tools and runs InteractiveMode.
 *
 * Communication:
 * - PTY stdin/stdout: terminal I/O (ink TUI)
 * - UDS: tool call requests/responses (JSON messages)
 */

import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import { createConnection } from 'node:net'
import { createAgentSession, DefaultResourceLoader, InteractiveMode } from '@mariozechner/pi-coding-agent'

import { Type } from '@sinclair/typebox'

const ipcPath = process.env.EXOAGENT_IPC
const capsDts = process.env.EXOAGENT_CAPS_DTS
const systemPrompt = process.env.EXOAGENT_SYSTEM_PROMPT

const main = async () => {
	const customTools: ToolDefinition[] = []

	// If we have caps, create the exoeval tool
	if (ipcPath && capsDts) {
		const ipc = createConnection(ipcPath)
		let nextId = 1
		const pending = new Map<number, { resolve: (v: unknown) => void, reject: (e: Error) => void }>()

		ipc.on('data', (buf) => {
			// Messages are newline-delimited JSON
			for (const line of buf.toString().split('\n')) {
				if (!line.trim()) { continue }
				try {
					const msg = JSON.parse(line) as { id: number, result?: unknown, error?: string }
					const p = pending.get(msg.id)
					if (p) {
						pending.delete(msg.id)
						if (msg.error) { p.reject(new Error(msg.error)) }
						else { p.resolve(msg.result) }
					}
				}
				catch { /* ignore malformed */ }
			}
		})

		const callExoeval = (code: string): Promise<unknown> => {
			const id = nextId++
			return new Promise((resolve, reject) => {
				pending.set(id, { resolve, reject })
				ipc.write(`${JSON.stringify({ id, code })}\n`)
			})
		}

		customTools.push({
			name: 'exoeval',
			label: 'Exoeval',
			description: `Execute JavaScript code against the following capabilities.\n\n\`\`\`typescript\n${capsDts}\n\`\`\`\n\nProvide a JavaScript function that takes the caps object and returns a result.\nExample: \`(caps) => caps.github.getUser("octocat")\``,
			parameters: Type.Object({
				code: Type.String({ description: 'JavaScript function: (caps) => { ... }' }),
			}),
			execute: async (_toolCallId: string, params: { code: string }) => {
				try {
					const result = await callExoeval(params.code)
					return {
						content: [{ type: 'text' as const, text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }],
						details: {},
					}
				}
				catch (err) {
					return {
						content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
						details: {},
					}
				}
			},
		})
	}

	const cwd = process.env.EXOAGENT_CWD || process.cwd()
	// When caps are provided, only expose exoeval (no built-in file/bash tools).
	// Built-in tools will be re-enabled when agents run inside scoped VMs.
	const tools = customTools.length > 0 ? [] : undefined

	const resourceLoader = systemPrompt
		? new DefaultResourceLoader({ cwd, systemPromptOverride: () => systemPrompt })
		: undefined

	const { session } = await createAgentSession({ cwd, customTools, tools, resourceLoader })
	const interactive = new InteractiveMode(session)
	await interactive.run()
}

main().catch((err) => {
	console.error('Agent worker error:', err)
	process.exit(1)
})
