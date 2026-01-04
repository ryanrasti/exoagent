import type { RawSql } from './sql'
import { buildSql, sql } from './sql'

export class SqlExpression {
  constructor(public precedence: number = 100) {}

  // `= () => ` to ensure the method is a direct property of the class instance,
  // not a method of the class prototype
  compile = (): RawSql => {
    throw new Error('Not implemented')
  }

  or(expr: SqlExpression) {
    return new BinaryExpression(this, expr, sql`OR`, 1)
  }

  and(expr: SqlExpression) {
    return new BinaryExpression(this, expr, sql`AND`, 2)
  }

  not() {
    return new UnaryExpression(this, sql`NOT`, 'prefix', 3)
  }

  isNull() {
    return new UnaryExpression(this, sql`IS NULL`, 'postfix', 4)
  }

  isNotNull() {
    return new UnaryExpression(this, sql`IS NOT NULL`, 'postfix', 4)
  }

  '<'(expr: SqlExpression) {
    return new BinaryExpression(this, expr, sql`<`, 5)
  }

  '<='(expr: SqlExpression) {
    return new BinaryExpression(this, expr, sql`<=`, 5)
  }

  '>'(expr: SqlExpression) {
    return new BinaryExpression(this, expr, sql`>`, 5)
  }

  '>='(expr: SqlExpression) {
    return new BinaryExpression(this, expr, sql`>=`, 5)
  }

  '='(expr: SqlExpression) {
    return new BinaryExpression(this, expr, sql`=`, 5)
  }

  '<>'(expr: SqlExpression) {
    return new BinaryExpression(this, expr, sql`<>`, 5)
  }

  '!='(expr: SqlExpression) {
    return new BinaryExpression(this, expr, sql`!=`, 5)
  }

  'LIKE'(expr: SqlExpression) {
    return new BinaryExpression(this, expr, sql`LIKE`, 6)
  }

  'NOT LIKE'(expr: SqlExpression) {
    return new BinaryExpression(this, expr, sql`NOT LIKE`, 6)
  }

  '+'(expr: SqlExpression) {
    return new BinaryExpression(this, expr, sql`+`, 8)
  }

  '-'(expr: SqlExpression) {
    return new BinaryExpression(this, expr, sql`-`, 8)
  }

  '*'(expr: SqlExpression) {
    return new BinaryExpression(this, expr, sql`*`, 9)
  }

  '/'(expr: SqlExpression) {
    return new BinaryExpression(this, expr, sql`/`, 9)
  }

  '%'(expr: SqlExpression) {
    return new BinaryExpression(this, expr, sql`%`, 9)
  }

  asc() {
    return new OrderByValue(this, sql`ASC`)
  }

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
  constructor(private alias: string, private column: string) {
    super()
  }

  // `= () => ` to ensure the method is a direct property of the class instance,
  // not a method of the class prototype
  compile = () => {
    return sql.ref(`${this.alias}.${this.column}`)
  }
}

// This is *not* a SqlExpression, it is a terminal expression used only
// in the context of an order by clause:
export class OrderByValue {
  constructor(public value: SqlExpression, public direction?: RawSql) { }
}
