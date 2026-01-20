import type { RawSql } from './sql'
import z from 'zod'
import { RpcToolset, tool } from '../rpc-toolset'
import { buildSql, sql } from './sql'

type LiteralValue = number | string | boolean | null
export type SqlExpressionIn = LiteralValue | SqlExpression
export const asSqlExpression = (value: LiteralValue | SqlExpression): SqlExpression => {
  return value instanceof SqlExpression ? value : new LiteralExpression(value)
}
export const isSqlExpressionIn = (value: unknown): value is SqlExpressionIn => {
  return typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean' || value === null || value === undefined || value instanceof SqlExpression
}

const zSqlExpression = z.custom<SqlExpression>((val): val is SqlExpression => val instanceof SqlExpression)
const zNumericSqlExpression = z.union([zSqlExpression, z.number(), z.string()])
const zSqlExpressionIn = z.union([zSqlExpression, z.number(), z.string(), z.boolean(), z.null()])

export class SqlExpression extends RpcToolset {
  constructor(public precedence: number = 100) {
    super()
  }

  // `= () => ` to ensure the method is a direct property of the class instance,
  // not a method of the class prototype
  compile = (): RawSql => {
    throw new Error('Not implemented')
  }

  @tool(zSqlExpression)
  or(expr: SqlExpression) {
    return new BinaryExpression(this, expr, sql`OR`, 1)
  }

  @tool(zSqlExpression)
  and(expr: SqlExpression) {
    return new BinaryExpression(this, expr, sql`AND`, 2)
  }

  @tool()
  not() {
    return new UnaryExpression(this, sql`NOT`, 'prefix', 3)
  }

  @tool()
  isNull() {
    return new UnaryExpression(this, sql`IS NULL`, 'postfix', 4)
  }

  @tool()
  isNotNull() {
    return new UnaryExpression(this, sql`IS NOT NULL`, 'postfix', 4)
  }

  @tool(zNumericSqlExpression)
  '<'(expr: SqlExpression | number | string) {
    return new BinaryExpression(this, asSqlExpression(expr), sql`<`, 5)
  }

  @tool(zNumericSqlExpression)
  '<='(expr: SqlExpression | number | string) {
    return new BinaryExpression(this, asSqlExpression(expr), sql`<=`, 5)
  }

  @tool(zNumericSqlExpression)
  '>'(expr: SqlExpression | number | string) {
    return new BinaryExpression(this, asSqlExpression(expr), sql`>`, 5)
  }

  @tool(zNumericSqlExpression)
  '>='(expr: SqlExpression | number | string) {
    return new BinaryExpression(this, asSqlExpression(expr), sql`>=`, 5)
  }

  @tool(zSqlExpressionIn)
  '='(expr: SqlExpressionIn) {
    return new BinaryExpression(this, asSqlExpression(expr), sql`=`, 5)
  }

  @tool(zSqlExpressionIn)
  '<>'(expr: SqlExpressionIn) {
    return new BinaryExpression(this, asSqlExpression(expr), sql`<>`, 5)
  }

  @tool(zSqlExpressionIn)
  '!='(expr: SqlExpressionIn) {
    return new BinaryExpression(this, asSqlExpression(expr), sql`!=`, 5)
  }

  @tool(z.union([zSqlExpression, z.string()]))
  'LIKE'(expr: SqlExpression | string) {
    return new BinaryExpression(this, asSqlExpression(expr), sql`LIKE`, 6)
  }

  @tool(z.union([zSqlExpression, z.string()]))
  'NOT LIKE'(expr: SqlExpression | string) {
    return new BinaryExpression(this, asSqlExpression(expr), sql`NOT LIKE`, 6)
  }

  @tool(zNumericSqlExpression)
  '+'(expr: SqlExpression | number | string) {
    return new BinaryExpression(this, asSqlExpression(expr), sql`+`, 8)
  }

  @tool(zNumericSqlExpression)
  '-'(expr: SqlExpression | number | string) {
    return new BinaryExpression(this, asSqlExpression(expr), sql`-`, 8)
  }

  @tool(zNumericSqlExpression)
  '*'(expr: SqlExpression | number | string) {
    return new BinaryExpression(this, asSqlExpression(expr), sql`*`, 9)
  }

  @tool(zNumericSqlExpression)
  '/'(expr: SqlExpression | number | string) {
    return new BinaryExpression(this, asSqlExpression(expr), sql`/`, 9)
  }

  @tool(zNumericSqlExpression)
  '%'(expr: SqlExpression | number | string) {
    return new BinaryExpression(this, asSqlExpression(expr), sql`%`, 9)
  }

  @tool()
  asc() {
    return new OrderByValue(this, sql`ASC`)
  }

  @tool()
  desc() {
    return new OrderByValue(this, sql`DESC`)
  }
}

export class BinaryExpression extends SqlExpression {
  constructor(
    private readonly left: SqlExpression,
    private readonly right: SqlExpression,
    private readonly operator: RawSql,
    precedence?: number,
  ) {
    super(precedence ?? 100)
  }

  // `= () => ` to ensure the method is a direct property of the class instance,
  // not a method of the class prototype
  compile = () => {
    const leftCompiled = this.left.compile()
    const rightCompiled = this.right.compile()

    return buildSql([
      this.precedence > this.left.precedence ? sql`(${leftCompiled})` : leftCompiled,
      this.operator,
      this.precedence > this.right.precedence ? sql`(${rightCompiled})` : rightCompiled,
    ])
  }
}

export class UnaryExpression extends SqlExpression {
  constructor(
    private readonly operand: SqlExpression,
    private readonly operator: RawSql,
    private readonly placement: 'prefix' | 'postfix',
    precedence?: number,
  ) {
    super(precedence ?? 100)
  }

  // `= () => ` to ensure the method is a direct property of the class instance,
  // not a method of the class prototype
  compile = () => {
    const operandCompiled = this.operand.compile()
    const wrappedOperand = this.precedence > this.operand.precedence ? sql`(${operandCompiled})` : operandCompiled
    return this.placement === 'postfix' ? buildSql([wrappedOperand, this.operator]) : buildSql([this.operator, wrappedOperand])
  }
}

export class ColumnReferenceExpression extends SqlExpression {
  constructor(public readonly alias: string, public readonly column: string) {
    super()
  }

  // `= () => ` to ensure the method is a direct property of the class instance,
  // not a method of the class prototype
  compile = () => {
    return sql.ref(`${this.alias}.${this.column}`)
  }
}

export class UnboundColumnReferenceExpression extends ColumnReferenceExpression {
  constructor(public readonly alias: string, public readonly column: string) {
    super(alias, column)
  }

  // `= () => ` to ensure the method is a direct property of the class instance,
  // not a method of the class prototype
  compile = () => {
    throw new Error('Unbound column reference cannot be compiled')
  }
}

export class LiteralExpression extends SqlExpression {
  constructor(private readonly value: LiteralValue) {
    super()
  }

  // `= () => ` to ensure the method is a direct property of the class instance,
  // not a method of the class prototype
  compile = () => {
    return sql`${this.value}`
  }
}

// This is *not* a SqlExpression, it is a terminal expression used only
// in the context of an order by clause:
export class OrderByValue {
  constructor(public value: SqlExpression, public direction?: RawSql) { }
}
