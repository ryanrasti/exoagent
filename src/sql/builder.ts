import type { RawSql } from './sql'
import invariant from 'tiny-invariant'
import { ColumnReferenceExpression, OrderByValue, SqlExpression } from './expression'
import { buildSql, sql } from './sql'

type RowLike = {
  [key: string]: SqlExpression
}

const isRowLike = (value: unknown): value is RowLike => {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
    && Object.entries(value).every(([key, value]) => typeof key === 'string' && value instanceof SqlExpression)
}

type NamespacedExpression<A, R> = (arg: A) => R

type FromItem<N extends string, F extends RowLike> = {
  alias: N
  rawSchema: () => F
  compile: () => RawSql
}
export const isFromItem = (value: unknown): value is FromItem<string, RowLike> => {
  return value instanceof QueryBuilder || value instanceof Table
}

type TableNamespace = {
  [key: string]: RowLike
}
type SelectItem<TN extends TableNamespace, S extends RowLike> = NamespacedExpression<TN, S>
type WhereItem<TN extends TableNamespace> = NamespacedExpression<TN, SqlExpression>
type OrderByItem<TN extends TableNamespace> = NamespacedExpression<TN, SqlExpression | SqlExpression[] | OrderByValue | OrderByValue[] | (SqlExpression | OrderByValue)[]>
type Tables<TN extends TableNamespace> = {
  [k in keyof TN & string]: {
    fromItem: FromItem<k, TN[k]>
    // null = base table (not a join)
    // 'inner' = JOIN
    joinType: 'inner' | 'left' | null
    on?: SqlExpression
    isLateral: boolean
  }
}

const fromItemToRowLike = <F extends RowLike>(alias: string, from: FromItem<any, F>): F => {
  return Object.fromEntries(Object.keys(from.rawSchema()).map(k => [k, new ColumnReferenceExpression(alias, k)])) as unknown as F
}

const namespacedArg = <TN extends TableNamespace>(tables: Tables<TN>): TN => {
  return Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, fromItemToRowLike(k, v.fromItem)])) as unknown as TN
}

type QueryBuilderParams<N extends string, TN extends TableNamespace, S extends RowLike> = {
  alias: N
  tables: Tables<TN>
  selectRowLike: S
  whereExpression?: SqlExpression
  orderByExpressions?: OrderByValue[]
  isBareTable?: boolean
  limit?: number
  offset?: number
}

class QueryBuilder<N extends string, TN extends TableNamespace, S extends RowLike> implements FromItem<N, S> {
  public readonly alias: N
  private selectRowLike: S
  private tables: Tables<TN>
  private whereExpression?: SqlExpression
  private orderByExpressions?: OrderByValue[]
  #limit?: number
  #offset?: number
  private arg: TN
  private isBareTable: boolean

  constructor(params: QueryBuilderParams<N, TN, S>) {
    this.alias = params.alias
    this.selectRowLike = params.selectRowLike
    this.tables = params.tables
    this.whereExpression = params.whereExpression
    this.orderByExpressions = params.orderByExpressions
    this.arg = namespacedArg(params.tables)
    this.isBareTable = params.isBareTable ?? false
    this.#limit = params.limit
    this.#offset = params.offset
  }

  select<S2 extends RowLike>(select: SelectItem<TN, S2>) {
    const selectResolved = select(this.arg)
    invariant(isRowLike(selectResolved), 'select must return a RowLike')
    return new QueryBuilder<N, TN, S2>({ ...this.params(), selectRowLike: selectResolved })
  }

  where(where: WhereItem<TN>) {
    const expr = where(this.arg)
    invariant(expr instanceof SqlExpression, 'where must return a SqlExpression')
    return new QueryBuilder<N, TN, S>({ ...this.params(), whereExpression: this.whereExpression ? this.whereExpression.and(expr) : expr })
  }

  orderBy(orderBy: OrderByItem<TN>) {
    const raw = orderBy(this.arg)
    const rawArray = Array.isArray(raw) ? raw : [raw]
    const exprs = rawArray.map((e) => {
      invariant(e instanceof SqlExpression || e instanceof OrderByValue, 'orderBy must return a SqlExpression/OrderByValue or an array of SqlExpressions/OrderByValues')
      return e instanceof SqlExpression ? new OrderByValue(e) : e
    })

    return new QueryBuilder<N, TN, S>({ ...this.params(), orderByExpressions: (this.orderByExpressions ?? []).concat(exprs) })
  }

  // Note that `limit` "attenuates": the new limit is the minimum of the new limit and the existing limit
  // (this is to ensure that the limit is not increased by subsequent calls to `limit`)
  limit(limit: number) {
    invariant(typeof limit === 'number' && limit >= 0, 'limit must be greater than or equal to 0')
    return new QueryBuilder<N, TN, S>({ ...this.params(), limit: Math.min(limit, this.#limit ?? Infinity) })
  }

  // Note that `offset` "accumulates": the new offset is the sum of the new offset and the existing offset
  // (this is to ensure that the offset is not reset by subsequent calls to `offset`)
  offset(offset: number) {
    invariant(typeof offset === 'number' && offset >= 0, 'offset must be greater than or equal to 0')
    return new QueryBuilder<N, TN, S>({ ...this.params(), offset: (this.#offset ?? 0) + offset })
  }

  join<N2 extends string, F2 extends RowLike>(fromItem: FromItem<N2, F2>
    | NamespacedExpression<TN, FromItem<N2, F2>>, on: NamespacedExpression<TN & { [k in N2]: F2 }, SqlExpression>) {
    // If `fromItem` is a function, it is implicitly a lateral join (depends on the other tables)
    const { fromItemResolved, isLateral } = typeof fromItem === 'function' ? { fromItemResolved: fromItem(this.arg), isLateral: true } : { fromItemResolved: fromItem, isLateral: false }
    invariant(isFromItem(fromItemResolved), 'fromItem must return a FromItem')

    const alias = fromItemResolved.alias

    if (this.tables[alias]) {
      throw new Error(`Join already exists: ${alias} in ${Object.keys(this.tables)}`)
    }

    const arg = {
      ...this.arg,
      [alias]: fromItemToRowLike(alias, fromItemResolved),
    }

    const onResolved = on(arg)
    invariant(onResolved instanceof SqlExpression, 'on must return a SqlExpression')
    const tablesWithAlias: Tables<TN & { [k in N2]: F2 }> = {
      ...this.tables,
      [alias]: {
        fromItem: fromItemResolved,
        on: onResolved,
        joinType: 'inner',
        isLateral,
      },
    } as Tables<TN & { [k in N2]: F2 }>
    return new QueryBuilder({ ...this.params(), tables: tablesWithAlias })
  }

  // Note, we use `= () => ` to ensure the method is a direct property of the class instance,
  // not a method of the class prototype
  private params = () => {
    return {
      alias: this.alias,
      tables: this.tables,
      selectRowLike: this.selectRowLike,
      whereExpression: this.whereExpression,
      orderByExpressions: this.orderByExpressions,
      limit: this.#limit,
      offset: this.#offset,
      // isBareTable is not included in the params because it should be set *explicitly* on construction
    }
  }

  rawSchema = () => {
    return this.selectRowLike
  }

  compile = () => {
    const { tables, selectRowLike, whereExpression, orderByExpressions } = this
    const tablesList = Object.entries(tables)
    const [[baseAlias, baseTable], ...rest] = tablesList.filter(([, table]) => table.joinType === null)
    if (this.isBareTable) {
      return baseTable.fromItem.compile()
    }

    const joins = tablesList.filter(([, table]) => table.joinType !== null)
    invariant(baseTable, 'Base table not found')
    invariant(rest.length === 0, 'Implicit joins not supported')
    invariant(Object.keys(selectRowLike).length > 0, 'select must return a non-empty row')

    return buildSql([
      sql`SELECT ${buildSql(Object.entries(selectRowLike).map(([key, value]) => sql`${value.compile()} as ${sql.ref(key)}`), sql`, `)}`,
      sql`FROM ${baseTable.fromItem.compile()} AS ${sql.ref(baseAlias)}`,
      ...joins.map(([alias, table]) => buildSql([table.joinType === 'inner' ? sql`JOIN` : table.joinType === 'left' ? sql`LEFT JOIN` : null, table.isLateral ? sql`LATERAL` : null, sql`${table.fromItem.compile()} AS ${sql.ref(alias)}`, table.on ? sql`ON ${table.on.compile()}` : null]), sql` `),
      whereExpression ? sql`WHERE ${whereExpression.compile()}` : null,
      orderByExpressions && orderByExpressions.length > 0
        ? sql`ORDER BY ${buildSql(orderByExpressions.map(expr => buildSql([expr.value.compile(), expr.direction])), sql`, `)}`
        : null,
      this.#limit != null ? sql`LIMIT ${this.#limit}` : null,
      this.#offset != null ? sql`OFFSET ${this.#offset}` : null,
    ])
  }
}

class Table<N extends string, R extends RowLike> implements FromItem<N, R> {
  public readonly alias: N
  public readonly columns: R

  constructor(name: N, columns: R) {
    this.alias = name
    this.columns = columns
  }

  // `= () => ` to ensure the method is a direct property of the class instance,
  // not a method of the class prototype
  rawSchema = () => {
    return this.columns
  }

  compile = () => {
    return sql.ref(this.alias)
  }
}

export const table = <N extends string, R extends string[]>(name: N, columns: R) => {
  const table = new Table<N, { [k in R[number]]: SqlExpression }>(name, Object.fromEntries(columns.map(c => [c, new ColumnReferenceExpression(name, c)])) as unknown as { [k in R[number]]: SqlExpression })
  const tables = { [name]: { fromItem: table, joinType: null, isLateral: false } } as unknown as Tables<{ [k in N]: { [k in R[number]]: SqlExpression } }>
  return new QueryBuilder({ alias: name, tables, selectRowLike: fromItemToRowLike(name, table), isBareTable: true })
}
