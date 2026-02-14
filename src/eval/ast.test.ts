import { describe, expect, it } from 'vitest'
import * as b from './ast'

describe('AST builders', () => {
  it('creates literals', () => {
    expect(b.literal('hello')).toMatchObject({ type: 'Literal', value: 'hello' })
    expect(b.literal(42)).toMatchObject({ type: 'Literal', value: 42 })
    expect(b.literal(true)).toMatchObject({ type: 'Literal', value: true })
    expect(b.literal(null)).toMatchObject({ type: 'Literal', value: null })
  })

  it('creates bigint literals', () => {
    expect(b.bigintLiteral(123n)).toMatchObject({
      type: 'Literal',
      value: 123n,
      bigint: '123',
    })
  })

  it('creates identifiers', () => {
    expect(b.id('foo')).toMatchObject({ type: 'Identifier', name: 'foo' })
  })

  it('creates member expressions', () => {
    const node = b.member(b.id('obj'), b.id('prop'))
    expect(node).toMatchObject({
      type: 'MemberExpression',
      object: { type: 'Identifier', name: 'obj' },
      property: { type: 'Identifier', name: 'prop' },
      computed: false,
    })
  })

  it('creates call expressions', () => {
    const node = b.call(b.id('fn'), [b.literal(1), b.literal(2)])
    expect(node).toMatchObject({
      type: 'CallExpression',
      callee: { type: 'Identifier', name: 'fn' },
      arguments: [
        { type: 'Literal', value: 1 },
        { type: 'Literal', value: 2 },
      ],
    })
  })

  it('creates array expressions', () => {
    const node = b.array([b.literal(1), b.literal(2)])
    expect(node).toMatchObject({
      type: 'ArrayExpression',
      elements: [
        { type: 'Literal', value: 1 },
        { type: 'Literal', value: 2 },
      ],
    })
  })

  it('creates object expressions', () => {
    const node = b.object([b.prop('x', b.literal(1))])
    expect(node).toMatchObject({
      type: 'ObjectExpression',
      properties: [{
        type: 'Property',
        key: { type: 'Identifier', name: 'x' },
        value: { type: 'Literal', value: 1 },
      }],
    })
  })

  it('creates const declarations', () => {
    const node = b.constDecl('foo', b.literal('bar'))
    expect(node).toMatchObject({
      type: 'VariableDeclaration',
      kind: 'const',
      declarations: [{
        type: 'VariableDeclarator',
        id: { type: 'Identifier', name: 'foo' },
        init: { type: 'Literal', value: 'bar' },
      }],
    })
  })

  it('creates programs', () => {
    const node = b.program([b.constDecl('x', b.literal(1))])
    expect(node).toMatchObject({
      type: 'Program',
      sourceType: 'module',
      body: [{
        type: 'VariableDeclaration',
        kind: 'const',
      }],
    })
  })
})
