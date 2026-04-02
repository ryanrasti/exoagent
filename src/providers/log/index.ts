/**
 * Log provider — structured logging via pino.
 *
 * ring0 provides the pino instance.
 * Each client gets a child logger with the client name as context.
 */

import type { ProviderInit } from '../../provider'
import type manifest from './manifest'
import z from 'zod'
import { tool } from '../../exoeval/tool'

type Ring0 = Awaited<ReturnType<typeof manifest.ring0>>

type PinoLogger = {
	child: (bindings: { [key: string]: unknown }) => PinoLogger
	trace: (msg: string) => void
	debug: (msg: string) => void
	info: (msg: string) => void
	warn: (msg: string) => void
	error: (msg: string) => void
}

export type LogProviderImpl = InstanceType<typeof ScopedLog>

class ScopedLog {
	private readonly log: PinoLogger

	constructor(log: PinoLogger) {
		this.log = log
	}

	@tool(z.string())
	trace(msg: string): void { this.log.trace(msg) }

	@tool(z.string())
	debug(msg: string): void { this.log.debug(msg) }

	@tool(z.string())
	info(msg: string): void { this.log.info(msg) }

	@tool(z.string())
	warn(msg: string): void { this.log.warn(msg) }

	@tool(z.string())
	error(msg: string): void { this.log.error(msg) }
}

class LogProvider {
	private readonly pino: PinoLogger

	constructor(ring0: Ring0) {
		this.pino = ring0.pino as PinoLogger
	}

	clientProvider(clientName: string): ScopedLog {
		return new ScopedLog(this.pino.child({ provider: clientName }))
	}

	uiProvider(_clients: string[]) {
		return this
	}
}

export default ({ ring0 }: ProviderInit) => new LogProvider(ring0 as Ring0)
