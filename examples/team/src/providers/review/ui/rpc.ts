/**
 * exoRpc wrapper for review provider UI.
 * Same pattern as the parent exoRpc but scoped to this provider.
 */

export const exoRpc = async <Caps>(
	fn: (caps: Caps) => unknown,
	capture?: { [key: string]: unknown },
): Promise<any> => {
	const fnSource = fn.toString()

	let prefix = ''
	if (capture) {
		for (const [key, value] of Object.entries(capture)) {
			prefix += `const ${key} = ${JSON.stringify(value)}; `
		}
	}

	const code = `${prefix}(${fnSource})({ review })`

	const res = await fetch('/rpc', {
		method: 'POST',
		body: code,
	})

	if (!res.ok) {
		throw new Error(await res.text())
	}

	return res.json()
}
