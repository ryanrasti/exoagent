/**
 * exoRpc — typed RPC helper for provider UIs.
 *
 * Takes a function and capture object, stringifies the function,
 * serializes captured values, and sends to the provider's /rpc endpoint.
 *
 * Usage:
 *   const result = await exoRpc<GitHubProvider>(
 *     ({ github }) => github.setToken(token),
 *     { token },
 *   )
 */

/**
 * Send an exoeval RPC to the current provider (determined by subdomain).
 *
 * @param fn - Function to stringify. First arg is the caps object.
 * @param capture - Free variables to serialize into the eval scope.
 */
export async function exoRpc<Caps>(
	fn: (caps: Caps) => unknown,
	capture?: { [key: string]: unknown },
): Promise<unknown> {
	const fnSource = fn.toString()

	// Build the eval expression.
	// Captured variables are serialized as const bindings prepended to the expression.
	let prefix = ''
	if (capture) {
		for (const [key, value] of Object.entries(capture)) {
			prefix += `const ${key} = ${JSON.stringify(value)}; `
		}
	}

	// The provider name comes from the subdomain (the host we're already on)
	// Extract it from the meta tag set by the server template
	const providerName = document.querySelector('meta[name="x-provider"]')?.getAttribute('content')
	if (!providerName) {
		throw new Error('exoRpc: could not determine provider name from page meta')
	}

	// The caps destructure uses the provider name as the key
	const code = `${prefix}(${fnSource})({ ${providerName} })`

	const res = await fetch('/rpc', {
		method: 'POST',
		body: code,
	})

	if (!res.ok) {
		throw new Error(await res.text())
	}

	return res.json()
}
