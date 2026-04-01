/**
 * BoundEval — typed exoeval closure with caps pre-bound.
 *
 * Providers receive a BoundEval<Caps> where Caps is determined by
 * the manifest's attenuation functions. All inter-provider calls
 * go through this single function.
 */

import { exoEval } from './exoeval'

/**
 * A typed eval closure. The function argument is stringified and evaluated
 * in exoeval with the caps + any captured variables in scope.
 */
export type BoundEval<Caps> = <T>(
	fn: (caps: Caps) => T,
	capture?: { [key: string]: unknown },
) => unknown

/**
 * Create a BoundEval that closes over the given cap bindings.
 *
 * When called, it:
 * 1. Stringifies the function via .toString()
 * 2. Merges caps + capture into the eval scope
 * 3. Evaluates `(fn)(caps)` where caps is a destructurable object
 */
export const makeBoundEval = <Caps>(capBindings: { [key: string]: unknown }): BoundEval<Caps> => {
	return (fn, capture) => {
		const fnSource = fn.toString()

		// Build the scope: caps + captured variables
		const scope: { [key: string]: unknown } = { ...capBindings }
		if (capture) {
			for (const [key, value] of Object.entries(capture)) {
				if (key in scope) {
					throw new Error(`capture key "${key}" collides with cap name`)
				}
				scope[key] = value
			}
		}

		// Build destructure keys from cap bindings for the call expression
		const capKeys = Object.keys(capBindings).join(', ')

		// Wrap: ((fn)({ capKey1, capKey2, ... }))
		// The cap names + capture names are all top-level bindings in exoeval scope
		const code = `(${fnSource})({ ${capKeys} })`

		return exoEval(code, scope)
	}
}
