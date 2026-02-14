/**
 * Simple AST builder helpers for ESTree/acorn nodes.
 * Avoids verbose object literals with start/end/type boilerplate.
 */
import type * as acorn from 'acorn'

const node = <T extends acorn.Node>(n: Omit<T, 'start' | 'end'>): T =>
  ({ start: 0, end: 0, ...n }) as T

// Literals
export const literal = (value: string | number | boolean | null | undefined): acorn.Literal =>
  node({ type: 'Literal', value, raw: JSON.stringify(value) })

export const bigintLiteral = (value: bigint): acorn.Literal =>
  node({ type: 'Literal', value, raw: `${value}n`, bigint: value.toString() })

// Identifiers
export const id = (name: string): acorn.Identifier =>
  node({ type: 'Identifier', name })

// Expressions
export const member = (object: acorn.Expression, property: acorn.Expression | acorn.Identifier, computed = false): acorn.MemberExpression =>
  node({ type: 'MemberExpression', object, property, computed, optional: false })

export const call = (callee: acorn.Expression, args: acorn.Expression[]): acorn.CallExpression =>
  node({ type: 'CallExpression', callee, arguments: args, optional: false })

export const array = (elements: (acorn.Expression | acorn.SpreadElement | null)[]): acorn.ArrayExpression =>
  node({ type: 'ArrayExpression', elements })

export const object = (properties: acorn.Property[]): acorn.ObjectExpression =>
  node({ type: 'ObjectExpression', properties })

export const prop = (key: string | acorn.Expression, value: acorn.Expression, computed = false): acorn.Property =>
  node({
    type: 'Property',
    method: false,
    shorthand: false,
    computed,
    kind: 'init',
    key: typeof key === 'string' ? id(key) : key,
    value,
  })

// Statements
export const constDecl = (name: string, init: acorn.Expression): acorn.VariableDeclaration =>
  node({
    type: 'VariableDeclaration',
    kind: 'const',
    declarations: [node({ type: 'VariableDeclarator', id: id(name), init })],
  })

export const program = (body: acorn.Statement[]): acorn.Program =>
  node({ type: 'Program', sourceType: 'module', body })
