/**
 * Fetch provider — capability-gated HTTP requests.
 *
 * Ring0: receives globalThis.fetch.
 * .scoped(clientName) → returns self (stateless).
 * .allow(...domains) → manifest-level domain attenuation.
 */

import type { ProviderInit } from '../../provider'
import type manifest from './manifest'
import z from 'zod'
import { tool } from '../../exoeval/tool'

type Ring0 = Awaited<ReturnType<typeof manifest.ring0>>

export type FetchInit = {
	method?: string
	headers?: { [key: string]: string }
	body?: string | null
	redirect?: RequestRedirect
}

export type FetchResponse = {
	status: number
	statusText: string
	headers: { [key: string]: string }
	body: string
}

const fetchInitSchema = z
	.object({
		method: z.string().optional(),
		headers: z.record(z.string(), z.string()).optional(),
		body: z.string().nullable().optional(),
		redirect: z.enum(['follow', 'error', 'manual']).optional(),
	})
	.optional()

export class FetchProviderImpl {
	private readonly nativeFetch: typeof globalThis.fetch

	constructor(nativeFetch: typeof globalThis.fetch) {
		this.nativeFetch = nativeFetch
	}

	clientProvider(_clientName: string): FetchProviderImpl {
		return this
	}

	@tool(z.array(z.string()))
	allow(domains: string[]): ScopedFetch {
		return new ScopedFetch(this.nativeFetch, new Set(domains))
	}
}

export default ({ ring0 }: ProviderInit) =>
	new FetchProviderImpl(ring0 as Ring0)

export class ScopedFetch {
	private readonly nativeFetch: typeof globalThis.fetch
	private readonly allowed: Set<string>

	constructor(nativeFetch: typeof globalThis.fetch, allowed: Set<string>) {
		this.nativeFetch = nativeFetch
		this.allowed = allowed
	}

	@tool(z.string(), fetchInitSchema)
	async fetch(url: string, init?: FetchInit): Promise<FetchResponse> {
		const parsed = new URL(url)

		if (!this.allowed.has(parsed.hostname)) {
			throw new Error(
				`Fetch blocked: ${parsed.hostname} not in allowed domains [${[...this.allowed].join(', ')}]`,
			)
		}

		const response = await this.nativeFetch(parsed.toString(), {
			method: init?.method,
			headers: init?.headers,
			body: init?.body,
			redirect: init?.redirect,
		})

		const headers: { [key: string]: string } = {}
		for (const [key, value] of response.headers) {
			headers[key] = value
		}

		return {
			status: response.status,
			statusText: response.statusText,
			headers,
			body: await response.text(),
		}
	}
}
