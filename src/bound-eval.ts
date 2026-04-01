/**
 * BoundEval — composable capability container with exoeval evaluation.
 *
 * Providers receive a BoundEval where caps are determined by
 * the manifest's attenuation functions. All inter-provider calls
 * go through .run().
 *
 * BoundEval supports:
 *   .run(fn, capture?)  — evaluate fn against bound caps
 *   .map(spec)          — attenuate caps, returns new BoundEval
 *   .union(other)       — combine caps from two BoundEvals (no overlapping keys)
 *   .capNames           — list of bound cap names
 */

import { exoEval } from './exoeval'

export class BoundEval<Caps = unknown> {
	private readonly bindings: { [key: string]: unknown }

	constructor(bindings: { [key: string]: unknown }) {
		this.bindings = bindings
	}

	/** Create a BoundEval from a plain bindings object. */
	static from<C>(bindings: { [key: string]: unknown }): BoundEval<C> {
		return new BoundEval<C>(bindings)
	}

	/** The cap names bound in this BoundEval. */
	get capNames(): string[] {
		return Object.keys(this.bindings)
	}

	/**
	 * Evaluate a function against the bound caps.
	 *
	 * The function is stringified and evaluated in exoeval with
	 * caps + any captured variables in scope.
	 */
	run<T>(fn: (caps: Caps) => T, capture?: { [key: string]: unknown }): unknown {
		const fnSource = fn.toString()

		// Build the scope: caps + captured variables
		const scope: { [key: string]: unknown } = { ...this.bindings }
		if (capture) {
			for (const [key, value] of Object.entries(capture)) {
				if (key in scope) {
					throw new Error(`capture key "${key}" collides with cap name`)
				}
				scope[key] = value
			}
		}

		const capKeys = Object.keys(this.bindings).join(', ')
		const code = `(${fnSource})({ ${capKeys} })`

		return exoEval(code, scope)
	}

	/**
	 * Attenuate caps — returns a new BoundEval with narrowed capabilities.
	 *
	 * Each key in the spec maps a cap name to an attenuation function.
	 * Only caps mentioned in the spec are included in the result.
	 *
	 * @example
	 * ```ts
	 * const agent = exoEval.map({
	 *   github: (g) => ({ listIssues: g.listIssues }),
	 *   matrix: (m) => m, // pass through fully
	 * })
	 * ```
	 */
	map<NewCaps = unknown>(spec: { [K in keyof Caps]?: (cap: Caps[K]) => unknown }): BoundEval<NewCaps> {
		const newBindings: { [key: string]: unknown } = {}
		for (const [key, fn] of Object.entries(spec)) {
			if (!(key in this.bindings)) {
				throw new Error(`map: cap "${key}" not found in BoundEval (have: ${this.capNames.join(', ')})`)
			}
			newBindings[key] = (fn as (cap: unknown) => unknown)(this.bindings[key])
		}
		return new BoundEval<NewCaps>(newBindings)
	}

	/**
	 * Combine caps from two BoundEvals. Errors if any keys overlap.
	 *
	 * @example
	 * ```ts
	 * const agentCaps = exoEval.map({ github: (g) => g, matrix: (m) => m })
	 * const inboxCaps = BoundEval.from({ inbox: scopedInbox })
	 * const full = agentCaps.union(inboxCaps)
	 * ```
	 */
	union<OtherCaps>(other: BoundEval<OtherCaps>): BoundEval<Caps & OtherCaps> {
		const combined: { [key: string]: unknown } = { ...this.bindings }
		for (const [key, value] of Object.entries(other.bindings)) {
			if (key in combined) {
				throw new Error(`union: cap "${key}" exists in both BoundEvals`)
			}
			combined[key] = value
		}
		return new BoundEval<Caps & OtherCaps>(combined)
	}
}


