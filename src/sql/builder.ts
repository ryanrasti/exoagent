import type { SqlExpressionIn } from './expression'
import type { RawSql } from './sql'
import invariant from 'tiny-invariant'
import { RpcToolset } from '../rpc-toolset'
import { asSqlExpression, ColumnReferenceExpression, isSqlExpressionIn, OrderByValue, SqlExpression } from './expression'
import { buildSql, sql } from './sql'

type RowLikeRaw = {
  [key: string]: SqlExpression
}

type RowLikeRawIn = {
  [key: string]: SqlExpressionIn
}

type RowLike = RowLikeRaw | TableBase

type RowLikeIn = RowLikeRawIn | RowLike

const asRowLike = <R extends RowLikeIn>(value: R): AsRowLike<R> => {
  if (value instanceof TableBase) {
    return value as unknown as AsRowLike<R>
  }
  return Object.fromEntries(Object.entries(value).map(([key, value]) => [key, asSqlExpression(value)])) as unknown as AsRowLike<R>
}

type AsRowLike<R extends RowLikeIn> = R extends TableBase ? R : {
  [key in keyof R]: R[key] extends SqlExpression ? R[key] : SqlExpression
}

const isRowLikeRawIn = (value: unknown): value is RowLikeRawIn => {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
    && Object.entries(value).every(([key, value]) => typeof key === 'string' && isSqlExpressionIn(value))
}

const isRowLikeIn = (value: unknown): value is RowLikeIn => {
  return isRowLikeRawIn(value) || value instanceof TableBase
}

const rowLikeRawEntries = (value: RowLike): [string, SqlExpression][] => {
  return Object.entries(value)
    .filter(([key, value]) => typeof key === 'string' && value instanceof SqlExpression)
}

type NamespacedExpression<A, R> = (arg: A) => R

type FromItem<N extends string, F extends RowLike> = {
  alias: N
  toRowLike: () => F
  compile: (opts?: { isSubquery?: boolean }) => RawSql
  onExpression?: SqlExpression
}

const isTableClass = (value: unknown): value is TableClass => {
  return typeof value === 'function' && value.prototype instanceof TableBase
}

export const isFromItem = (value: unknown): value is FromItem<string, RowLike> => {
  return value instanceof QueryBuilder || isTableClass(value)
}

const combinePredicates = (...predicates: (SqlExpression | undefined)[]): SqlExpression | undefined => {
  const filtered = predicates.filter(p => p != null)
  if (filtered.length === 0) {
    return undefined
  }
  return filtered.reduce((acc, predicate) => acc.and(predicate))
}

type TableNamespace = {
  [key: string]: RowLike
}
type SelectItem<TN extends TableNamespace, S extends RowLikeIn> = NamespacedExpression<TN, S>
type WhereItem<TN extends TableNamespace> = NamespacedExpression<TN, SqlExpressionIn>
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

const namespacedArg = <TN extends TableNamespace>(tables: Tables<TN>): TN => {
  return Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.fromItem.toRowLike()])) as unknown as TN
}

type QueryBuilderParams<N extends string, TN extends TableNamespace, S extends RowLike> = {
  alias: N
  tables: Tables<TN>
  selectRowLike: S
  whereExpression?: SqlExpression
  orderByExpressions?: OrderByValue[]
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

  constructor(params: QueryBuilderParams<N, TN, S>) {
    this.alias = params.alias
    this.selectRowLike = params.selectRowLike
    this.tables = params.tables
    this.whereExpression = params.whereExpression
    this.orderByExpressions = params.orderByExpressions
    this.arg = namespacedArg(params.tables)
    this.#limit = params.limit
    this.#offset = params.offset
  }

  select<S2 extends RowLikeIn>(select: SelectItem<TN, S2>) {
    const selectResolved = select(this.arg)
    invariant(isRowLikeIn(selectResolved), 'select must return a RowLike')
    return new QueryBuilder<N, TN, AsRowLike<S2>>({ ...this.params(), selectRowLike: asRowLike(selectResolved) })
  }

  where(where: WhereItem<TN>) {
    const expr = where(this.arg)
    invariant(isSqlExpressionIn(expr), 'where must return a SqlExpressionIn')
    return new QueryBuilder<N, TN, S>({ ...this.params(), whereExpression: combinePredicates(this.whereExpression, asSqlExpression(expr)) })
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

  join<N2 extends string, F2 extends TableClass<N2>>(fromItem: F2 | NamespacedExpression<TN, F2>, on?: NamespacedExpression<TN & { [k in N2]: InstanceType<F2> }, SqlExpressionIn>): QueryBuilder<N, TN & { [k in N2]: InstanceType<F2> }, S>
  join<N2 extends string, F2 extends RowLike>(fromItem: FromItem<N2, F2>
    | NamespacedExpression<TN, FromItem<N2, F2>>, on?: NamespacedExpression<TN & { [k in N2]: F2 }, SqlExpressionIn>): QueryBuilder<N, TN & { [k in N2]: F2 }, S>

  join<N2 extends string, F2 extends RowLike>(fromItem: FromItem<N2, F2>
    | NamespacedExpression<TN, FromItem<N2, F2>>, on?: NamespacedExpression<TN & { [k in N2]: F2 }, SqlExpressionIn>) {
    const fromItemResolved = isFromItem(fromItem) ? fromItem : fromItem(this.arg)
    fromItemResolved satisfies FromItem<N2, F2>
    invariant(isFromItem(fromItemResolved), 'fromItem must return a FromItem')

    const alias = fromItemResolved.alias

    if (this.tables[alias]) {
      throw new Error(`Join already exists: ${alias} in ${Object.keys(this.tables)}`)
    }

    const arg = {
      ...this.arg,
      [alias]: fromItemResolved.toRowLike(),
    }

    const onRaw = on?.(arg)
    invariant(onRaw == null || isSqlExpressionIn(onRaw), 'on must return a SqlExpressionIn')
    const onResolved = combinePredicates(on && asSqlExpression(onRaw), fromItemResolved.onExpression)
    invariant(onResolved != null, 'Must specify an `on` expression or use `Table.on` to set the on expression')

    invariant(onResolved instanceof SqlExpression, 'on must return a SqlExpression')
    const tablesWithAlias: Tables<TN & { [k in N2]: F2 }> = {
      ...this.tables,
      [alias]: {
        fromItem: fromItemResolved,
        on: onResolved,
        joinType: 'inner',
        // If `fromItem` is a function that returns a QueryBuilder, it is implicitly a lateral join (depends on the other tables)
        isLateral: !isFromItem(fromItem) && fromItemResolved instanceof QueryBuilder,
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
    }
  }

  toRowLike = (): S => {
    if (this.selectRowLike instanceof TableBase) {
      // If we're selecting a table instance directly, we need to do 2 things:
      // 1. Re-alias the table name to the alias of the subquery
      // 2. Remap the columns to the actual column names in the outer query
      // * i.e., if the table has `bar = this.column('foo')`, that means a subquery (SELECT user.foo as bar)
      // will be generated -- so references to the column should be remapped to `bar`:
      const tableClass = this.selectRowLike.constructor as TableClass
      return tableClass.as(this.alias).toRowLike({ remapColumns: true }) as unknown as S
    }
    return Object.fromEntries(Object.keys(this.selectRowLike).map(key => [key, new ColumnReferenceExpression(this.alias, key)])) as unknown as S
  }

  compile = (opts?: { isSubquery?: boolean }) => {
    const { tables, selectRowLike, whereExpression, orderByExpressions } = this
    const tablesList = Object.entries(tables)
    const [[_, baseTable], ...rest] = tablesList.filter(([alias, table]) => {
      invariant(table.fromItem.alias === alias, `Alias mismatch: ${table.fromItem.alias} !== ${alias}`)
      return table.joinType === null
    })

    const joins = tablesList.filter(([, table]) => table.joinType !== null)
    invariant(baseTable, 'Base table not found')
    invariant(rest.length === 0, 'Implicit joins not supported')
    invariant(Object.keys(selectRowLike).length > 0, 'select must return a non-empty row')

    // If the base table has an on expression, it is moved to the where expression:
    const combinedWhere = combinePredicates(whereExpression, baseTable.fromItem.onExpression)

    const result = buildSql([
      sql`SELECT ${buildSql(rowLikeRawEntries(selectRowLike).map(([key, value]) => sql`${value.compile()} as ${sql.ref(key)}`), sql`, `)}`,
      sql`FROM ${baseTable.fromItem.compile({ isSubquery: true })}`,
      ...joins.map(([, table]) => buildSql([table.joinType === 'inner' ? sql`JOIN` : table.joinType === 'left' ? sql`LEFT JOIN` : null, table.isLateral ? sql`LATERAL` : null, table.fromItem.compile({ isSubquery: true }), table.on ? sql`ON ${table.on.compile()}` : null]), sql` `),
      combinedWhere ? sql`WHERE ${combinedWhere.compile()}` : null,
      orderByExpressions && orderByExpressions.length > 0
        ? sql`ORDER BY ${buildSql(orderByExpressions.map(expr => buildSql([expr.value.compile(), expr.direction])), sql`, `)}`
        : null,
      this.#limit != null ? sql`LIMIT ${this.#limit}` : null,
      this.#offset != null ? sql`OFFSET ${this.#offset}` : null,
    ])
    return opts?.isSubquery ? sql`(${result}) AS ${sql.ref(this.alias)}` : result
  }
}

class TableBase extends RpcToolset {

}

export type TableClass<N extends string = string> = ReturnType<typeof Table<N>>

export const Table = <N extends string>(name: N) => {
  const { [name]: tableClass } = { [name]: class extends TableBase {
    static readonly tableName: string = name
    static readonly alias: N = name
    static readonly onExpression?: SqlExpression

    static from<T extends TableClass>(this: T): QueryBuilder<N, { [k in N]: InstanceType<T> }, InstanceType<T>> {
      const alias = this.alias ?? this.tableName
      const tables = { [alias]: { fromItem: this, joinType: null, isLateral: false } } as unknown as Tables<{ [k in N]: InstanceType<T> }>
      return new QueryBuilder({ alias: alias as N, tables, selectRowLike: this.toRowLike() })
    }

    static as<T extends TableClass, N2 extends string>(this: T, alias: N2) {
      class Ret extends (this as TableClass) {
        static readonly alias = alias
      }
      return Ret as unknown as Omit<T, keyof TableClass> & TableClass<N2> & {
        new(): InstanceType<T>
      }
    }

    static on<T extends TableClass>(this: T, on: NamespacedExpression<InstanceType<T>, SqlExpression>): T {
      const Base = this
      return class extends (Base as TableClass) {
        static readonly onExpression = combinePredicates(Base.onExpression, on(Base.toRowLike()))
      } as T
    }

    // `= () => ` to ensure the method is a direct property of the class instance,
    // not a method of the class prototype
    column = function (this: InstanceType<TableClass<string>>, columnName: string): ColumnReferenceExpression {
      const cls = this.constructor as TableClass<string>
      return new ColumnReferenceExpression(cls.alias ?? cls.tableName, columnName)
    }

    // use `function` to bind `this` to the current class instance
    static toRowLike = function <T extends TableClass<string>>(this: T, opts?: { remapColumns?: boolean }): InstanceType<T> {
      const rowLike = new this() as unknown as InstanceType<T>
      // `remapColumns` is used when the table is used as a subquery, to remap the columns (including
      // "computed columns") to what they will actually be called in the outer query.
      if (opts?.remapColumns) {
        for (const [key] of rowLikeRawEntries(rowLike)) {
          rowLike[key as keyof InstanceType<T>] = new ColumnReferenceExpression(this.alias ?? this.tableName, key) as unknown as InstanceType<T>[keyof InstanceType<T>]
        }
      }
      return rowLike
    }

    static compile = function (this: TableClass<string>): RawSql {
      return sql`${sql.ref(this.tableName)} AS ${sql.ref(this.alias ?? this.tableName)}`
    }
  } }
  tableClass satisfies FromItem<N, RowLike>

  return tableClass
}
