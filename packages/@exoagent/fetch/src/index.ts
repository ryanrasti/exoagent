import { RpcTarget } from 'capnweb'

/** RequestInit with non-serializable fields removed. */
export type FetchInit = Omit<RequestInit, 'signal' | 'body' | 'headers' | 'fetcher' | 'cf'> & {
	headers?: { [key: string]: string }
	body?: string | null
}

/** Plain-object response, fully serializable. */
export interface FetchResponse {
	status: number
	statusText: string
	headers: { [key: string]: string }
	body: string
}

/**
 * Fetch provider — root cap.
 * Control plane holds this, creates scoped views for providers/exos.
 */
export class FetchProvider extends RpcTarget {
	/** Create a fetch cap scoped to specific domains. */
	scoped(...domains: string[]): ScopedFetch {
		return new ScopedFetch(new Set(domains))
	}
}

/**
 * Scoped fetch cap — only allows requests to specific domains.
 * Providers/exos receive this via env.providers.fetch.
 */
export class ScopedFetch extends RpcTarget {
	#allowed: Set<string>

	constructor(allowed: Set<string>) {
		super()
		this.#allowed = allowed
	}

	/** Fetch a URL. Only allowed domains are reachable. */
	async fetch(url: string, init?: FetchInit): Promise<FetchResponse> {
		const parsed = new URL(url)

		if (!this.#allowed.has(parsed.hostname)) {
			throw new Error(`Fetch blocked: ${parsed.hostname} not in allowed domains [${[...this.#allowed].join(', ')}]`)
		}

		const response = await fetch(parsed.toString(), {
			method: init?.method,
			headers: init?.headers,
			body: init?.body,
			redirect: init?.redirect,
			integrity: init?.integrity,
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
