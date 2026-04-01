import { describe, expect, it } from 'vitest'
import z from 'zod'
import { makeBoundEval } from './bound-eval'
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

describe('BoundEval', () => {
	it('calls @tool() methods via stringified function', () => {
		const config = new MockConfig()
		const exoEval = makeBoundEval<{ config: MockConfig }>({ config })

		exoEval(({ config }) => config.set('key', 'value'))
		const result = exoEval(({ config }) => config.get('key'))
		expect(result).toBe('value')
	})

	it('passes capture variables as free variables in eval scope', () => {
		const config = new MockConfig()
		const exoEval = makeBoundEval<{ config: MockConfig }>({ config })

		const key = 'myKey'
		const value = 'myValue'
		exoEval(({ config }) => config.set(key, value), { key, value })

		const result = exoEval(({ config }) => config.get(key), { key })
		expect(result).toBe('myValue')
	})

	it('throws on capture key collision with cap name', () => {
		const config = new MockConfig()
		const exoEval = makeBoundEval<{ config: MockConfig }>({ config })

		expect(() => {
			exoEval(({ config }) => config.get('x'), { config: 'collision' })
		}).toThrow(/collides/)
	})

	it('handles multiple caps', () => {
		const a = new MockConfig()
		const b = new MockConfig()
		const exoEval = makeBoundEval<{ a: MockConfig, b: MockConfig }>({ a, b })

		exoEval(({ a }) => a.set('x', '1'))
		exoEval(({ b }) => b.set('x', '2'))

		expect(exoEval(({ a }) => a.get('x'))).toBe('1')
		expect(exoEval(({ b }) => b.get('x'))).toBe('2')
	})
})
