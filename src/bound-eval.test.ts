import { describe, expect, it } from 'vitest'
import z from 'zod'
import { BoundEval } from './bound-eval'
import { tool } from './exoeval/tool'

class MockConfig {
	private data = new Map<string, string>()

	@tool(z.string())
	get(key: string): string | null {
		return this.data.get(key) ?? null
	}

	@tool(z.string(), z.string())
	set(key: string, value: string): { ok: true } {
		this.data.set(key, value)
		return { ok: true }
	}
}

class MockGithub {
	@tool(z.string(), z.string())
	createIssue(_owner: string, _title: string): { number: number } {
		return { number: 42 }
	}

	@tool()
	deleteRepo(): { ok: true } {
		return { ok: true }
	}
}

describe('BoundEval.run()', () => {
	it('calls @tool() methods via stringified function', () => {
		const config = new MockConfig()
		const be = new BoundEval<{ config: MockConfig }>({ config })

		be.run(({ config }) => config.set('key', 'value'))
		expect(be.run(({ config }) => config.get('key'))).toBe('value')
	})

	it('passes capture variables as free variables in eval scope', () => {
		const config = new MockConfig()
		const be = new BoundEval<{ config: MockConfig }>({ config })

		const key = 'myKey'
		const value = 'myValue'
		be.run(({ config }) => config.set(key, value), { key, value })
		expect(be.run(({ config }) => config.get(key), { key })).toBe('myValue')
	})

	it('throws on capture key collision with cap name', () => {
		const config = new MockConfig()
		const be = new BoundEval<{ config: MockConfig }>({ config })

		expect(() => {
			be.run(({ config }) => config.get('x'), { config: 'collision' })
		}).toThrow(/collides/)
	})

	it('handles multiple caps', () => {
		const a = new MockConfig()
		const b = new MockConfig()
		const be = new BoundEval<{ a: MockConfig, b: MockConfig }>({ a, b })

		be.run(({ a }) => a.set('x', '1'))
		be.run(({ b }) => b.set('x', '2'))

		expect(be.run(({ a }) => a.get('x'))).toBe('1')
		expect(be.run(({ b }) => b.get('x'))).toBe('2')
	})
})

describe('BoundEval class', () => {
	it('.run() evaluates against caps', () => {
		const config = new MockConfig()
		const be = new BoundEval<{ config: MockConfig }>({ config })

		be.run(({ config }) => config.set('k', 'v'))
		expect(be.run(({ config }) => config.get('k'))).toBe('v')
	})

	it('.capNames returns bound cap names', () => {
		const be = new BoundEval({ alpha: 1, beta: 2 })
		expect(be.capNames).toEqual(['alpha', 'beta'])
	})

	it('.map() attenuates caps', () => {
		const github = new MockGithub()
		const be = new BoundEval<{ github: MockGithub }>({ github })

		const attenuated = be.map({
			github: g => ({ createIssue: g.createIssue }),
		})

		expect(attenuated.capNames).toEqual(['github'])
		// createIssue works
		expect(attenuated.run(({ github }: any) => github.createIssue('o', 't'))).toEqual({ number: 42 })
		// deleteRepo is not exposed
		expect(() => attenuated.run(({ github }: any) => github.deleteRepo())).toThrow()
	})

	it('.map() drops caps not in spec', () => {
		const config = new MockConfig()
		const github = new MockGithub()
		const be = new BoundEval<{ config: MockConfig, github: MockGithub }>({ config, github })

		const attenuated = be.map({ github: g => g })
		expect(attenuated.capNames).toEqual(['github'])
	})

	it('.map() throws on unknown cap', () => {
		const be = new BoundEval({ config: new MockConfig() })
		expect(() => be.map({ nope: (x: any) => x } as any)).toThrow(/not found/)
	})

	it('.union() combines caps', () => {
		const config = new MockConfig()
		const github = new MockGithub()
		const a = new BoundEval<{ config: MockConfig }>({ config })
		const b = new BoundEval<{ github: MockGithub }>({ github })

		const combined = a.union(b)
		expect(combined.capNames.sort()).toEqual(['config', 'github'])

		combined.run(({ config }) => config.set('x', '1'))
		expect(combined.run(({ config }) => config.get('x'))).toBe('1')
		expect(combined.run(({ github }) => github.createIssue('o', 't'))).toEqual({ number: 42 })
	})

	it('.union() throws on overlapping keys', () => {
		const a = new BoundEval({ x: 1 })
		const b = new BoundEval({ x: 2 })
		expect(() => a.union(b)).toThrow(/exists in both/)
	})

	it('.map() then .union() composes', () => {
		const config = new MockConfig()
		const github = new MockGithub()
		const be = new BoundEval<{ config: MockConfig, github: MockGithub }>({ config, github })

		// Attenuate github, drop config
		const agentCaps = be.map({
			github: g => ({ createIssue: g.createIssue }),
		})

		// Add inbox (using a toolable class)
		const inbox = new MockConfig() // reuse MockConfig as a stand-in
		const inboxCaps = BoundEval.from({ inbox })

		const full = agentCaps.union(inboxCaps)
		expect(full.capNames.sort()).toEqual(['github', 'inbox'])
		full.run(({ inbox }: any) => inbox.set('k', 'v'))
		expect(full.run(({ inbox }: any) => inbox.get('k'))).toBe('v')
		expect(full.run(({ github }: any) => github.createIssue('o', 't'))).toEqual({ number: 42 })
	})
})

describe('BoundEval with function arguments', () => {
	it('can pass function from .run() to @tool method', () => {
		class EventSource {
			callbacks: Array<(x: number) => number> = []
			@tool(z.any())
			onEvent(cb: (x: number) => number) { this.callbacks.push(cb) }
		}
		const es = new EventSource()
		const be = new BoundEval<{ es: EventSource }>({ es })
		be.run(({ es }) => es.onEvent(x => x + 1))
		expect(es.callbacks.length).toBe(1)
		expect(es.callbacks[0](5)).toBe(6)
	})
})
