import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'
import rule from './eslint-exo-rule'

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parser: await import('@typescript-eslint/parser'),
  },
})

describe('exo/restricted-syntax', () => {
  it('allows valid exo syntax', () => {
    tester.run('restricted-syntax', rule, {
      valid: [
        `export default async ({ storage }) => {
          const x = 'hello'
          const upper = x.toUpperCase()
          await storage.set('key', upper)
        }`,
        `import type { Foo } from './types'
         export default async () => { }`,
        `export default async () => {
          const x = true
          if (x) { const a = 1 } else { const b = 2 }
        }`,
        `export default async () => {
          const x = 1 > 2 ? 'yes' : 'no'
          const y = \`hello \${x}\`
          const z = 1 + 2
        }`,
      ],
      invalid: [],
    })
  })

  it('rejects let/var', () => {
    tester.run('restricted-syntax', rule, {
      valid: [],
      invalid: [
        { code: `export default () => { let x = 1 }`, errors: [{ messageId: 'constOnly' }] },
        { code: `export default () => { var x = 1 }`, errors: [{ messageId: 'constOnly' }] },
      ],
    })
  })

  it('rejects loops', () => {
    tester.run('restricted-syntax', rule, {
      valid: [],
      invalid: [
        { code: `export default () => { for (const i of [1]) { i } }`, errors: [{ messageId: 'disallowedStatement' }] },
        { code: `export default () => { while (true) { } }`, errors: [{ messageId: 'disallowedStatement' }] },
        { code: `export default () => { do { } while (true) }`, errors: [{ messageId: 'disallowedStatement' }] },
      ],
    })
  })

  it('rejects try-catch', () => {
    tester.run('restricted-syntax', rule, {
      valid: [],
      invalid: [
        { code: `export default () => { try { } catch (e) { } }`, errors: [{ messageId: 'disallowedStatement' }] },
      ],
    })
  })

  it('rejects assignment expressions', () => {
    tester.run('restricted-syntax', rule, {
      valid: [],
      invalid: [
        { code: `export default () => { let x = 1; x = 2 }`, errors: [{ messageId: 'constOnly' }, { messageId: 'disallowedExpression' }] },
      ],
    })
  })

  it('rejects runtime imports', () => {
    tester.run('restricted-syntax', rule, {
      valid: [],
      invalid: [
        { code: `import { something } from 'somewhere'\nexport default () => { }`, errors: [{ messageId: 'disallowedModuleDeclaration' }] },
      ],
    })
  })

  it('rejects named exports', () => {
    tester.run('restricted-syntax', rule, {
      valid: [],
      invalid: [
        { code: `export const foo = 1`, errors: [{ messageId: 'disallowedModuleDeclaration' }] },
      ],
    })
  })
})
