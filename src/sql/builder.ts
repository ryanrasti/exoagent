import type { CompiledQuery, Dialect } from 'kysely'
import type { ToolCallback } from '../rpc-toolset'
import type { SqlExpressionIn } from './expression'
import type { RawSql } from './sql'
import { Kysely } from 'kysely'
import invariant from 'tiny-invariant'
import z from 'zod'
import { RpcToolset, setToolMetadata, tool } from '../rpc-toolset'
import { asSqlExpression, ColumnReferenceExpression, isSqlExpressionIn, OrderByValue, SqlExpression, UnboundColumnReferenceExpression } from './expression'
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
  const entries: [string, SqlExpression][] = []

  const myKeys = Object.keys(value)
  const protoKeys = []

  let proto = Object.getPrototypeOf(value)
  while (proto != null && proto !== TableBase.prototype) {
    protoKeys.push(...Object.keys(proto))
    proto = Object.getPrototypeOf(proto)
  }

  for (const key of new Set([...myKeys, ...protoKeys])) {
    const v = value[key as keyof RowLike]
    if (v instanceof SqlExpression) {
      entries.push([key, v])
    }
  }

  return entries
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
  db: Database
  alias: N
  tables: Tables<TN>
  selectRowLike: S
  whereExpression?: SqlExpression
  orderByExpressions?: OrderByValue[]
  limit?: number
  offset?: number
  rawTable: TableClass<N> | undefined // set only when created directly from a TableClass
}

class QueryBuilder<N extends string, TN extends TableNamespace, S extends RowLike> extends RpcToolset implements FromItem<N, S> {
  #db: Database
  public readonly alias: N
  private selectRowLike: S
  private tables: Tables<TN>
  private whereExpression?: SqlExpression
  private orderByExpressions?: OrderByValue[]
  #limit?: number
  #offset?: number
  private arg: TN
  private rawTable: TableClass | undefined // set only when created directly from a TableClass

  constructor(params: QueryBuilderParams<N, TN, S>) {
    super()
    this.#db = params.db
    this.alias = params.alias
    this.selectRowLike = params.selectRowLike
    this.tables = params.tables
    this.whereExpression = params.whereExpression
    this.orderByExpressions = params.orderByExpressions
    this.arg = namespacedArg(params.tables)
    this.#limit = params.limit
    this.#offset = params.offset
    this.rawTable = params.rawTable
  }

  @tool.callback()
  select<S2 extends RowLikeIn>(select: ToolCallback<(arg: TN) => S2>) {
    const selectUnwrapped = tool.unwrap(select, isRowLikeIn as (arg: unknown) => arg is S2)
    return selectUnwrapped(this.arg, (result) => {
      return new QueryBuilder<N, TN, AsRowLike<S2>>({ ...this.paramsForCopy(), selectRowLike: asRowLike(result) })
    })
  }

  @tool.callback()
  where(where: ToolCallback<(arg: TN) => SqlExpressionIn>) {
    const whereUnwrapped = tool.unwrap(where, isSqlExpressionIn)
    return whereUnwrapped(this.arg, (result) => {
      return new QueryBuilder<N, TN, S>({ ...this.paramsForCopy(), whereExpression: combinePredicates(this.whereExpression, asSqlExpression(result)) })
    })
  }

  @tool.callback()
  orderBy(orderBy: ToolCallback<OrderByItem<TN>>) {
    const orderByUnwrapped = tool.unwrap(orderBy, (arg): arg is ReturnType<OrderByItem<TN>> => {
      if (Array.isArray(arg)) {
        return arg.every(e => e instanceof SqlExpression || e instanceof OrderByValue)
      }
      return arg instanceof SqlExpression || arg instanceof OrderByValue
    })
    return orderByUnwrapped(this.arg, (raw) => {
      const rawArray = Array.isArray(raw) ? raw : [raw]
      const exprs = rawArray.map((e) => {
        invariant(e instanceof SqlExpression || e instanceof OrderByValue, 'orderBy must return a SqlExpression/OrderByValue or an array of SqlExpressions/OrderByValues')
        return e instanceof SqlExpression ? new OrderByValue(e) : e
      })

      return new QueryBuilder<N, TN, S>({ ...this.paramsForCopy(), orderByExpressions: (this.orderByExpressions ?? []).concat(exprs) })
    })
  }

  // Note that `limit` "attenuates": the new limit is the minimum of the new limit and the existing limit
  // (this is to ensure that the limit is not increased by subsequent calls to `limit`)
  @tool(z.number().int().nonnegative())
  limit(limit: number) {
    invariant(typeof limit === 'number' && limit >= 0, 'limit must be greater than or equal to 0')
    return new QueryBuilder<N, TN, S>({ ...this.paramsForCopy(), limit: Math.min(limit, this.#limit ?? Infinity) })
  }

  // Note that `offset` "accumulates": the new offset is the sum of the new offset and the existing offset
  // (this is to ensure that the offset is not reset by subsequent calls to `offset`)
  @tool(z.number().int().nonnegative())
  offset(offset: number) {
    invariant(typeof offset === 'number' && offset >= 0, 'offset must be greater than or equal to 0')
    return new QueryBuilder<N, TN, S>({ ...this.paramsForCopy(), offset: (this.#offset ?? 0) + offset })
  }

  join<N2 extends string, F2 extends TableClass<N2>>(fromItem: F2 | NamespacedExpression<TN, F2>, on?: NamespacedExpression<TN & { [k in N2]: InstanceType<F2> }, SqlExpressionIn>): QueryBuilder<N, TN & { [k in N2]: InstanceType<F2> }, S>
  join<N2 extends string, F2 extends RowLike>(fromItem: FromItem<N2, F2>
    | NamespacedExpression<TN, FromItem<N2, F2>>, on?: NamespacedExpression<TN & { [k in N2]: F2 }, SqlExpressionIn>): QueryBuilder<N, TN & { [k in N2]: F2 }, S>

  @tool.unsafeNoValidation()
  join<N2 extends string, F2 extends RowLikeRaw>(fromItem: FromItem<N2, F2>
    | NamespacedExpression<TN, FromItem<N2, F2>>, on?: NamespacedExpression<TN & { [k in N2]: F2 }, SqlExpressionIn>) {
    const fromItemCallbackRaw = isFromItem(fromItem) ? () => fromItem : fromItem as NamespacedExpression<TN, FromItem<N2, F2>>
    const fromItemCallback = tool.unwrap(fromItemCallbackRaw, isFromItem as (arg: unknown) => arg is FromItem<N2, F2>)

    const res = fromItemCallback(this.arg, (fromItemResolved) => {
      if (fromItemResolved instanceof QueryBuilder && fromItemResolved.rawTable) {
        // If we're joining to a raw table, use it because it might have an `onExpression`
        //  (and its more efficient to use the raw table than to re-SELECT from it)
        fromItemResolved = fromItemResolved.rawTable as unknown as FromItem<N2, F2>
      }
      const alias = fromItemResolved.alias

      if (this.tables[alias]) {
        throw new Error(`Join already exists: ${alias} in ${Object.keys(this.tables)}`)
      }

      const arg = {
        ...this.arg,
        [alias]: fromItemResolved.toRowLike(),
      }

      const onCallback = tool.unwrap(on ?? (() => undefined), (raw: unknown): raw is SqlExpressionIn | undefined => raw === undefined || isSqlExpressionIn(raw))
      return onCallback(arg, (onRaw) => {
        const onResolved = combinePredicates(onRaw !== undefined ? asSqlExpression(onRaw) : undefined, fromItemResolved.onExpression)
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
        return new QueryBuilder({ ...this.paramsForCopy(), tables: tablesWithAlias })
      })
    })

    return res
  }

  @tool()
  async execute(): Promise<{ [key in keyof S]: unknown }[]> {
    return await this.#db.execute(this.compile()) as { [key in keyof S]: unknown }[]
  }

  // Note, we use `= () => ` to ensure the method is a direct property of the class instance,
  // not a method of the class prototype
  private paramsForCopy = () => {
    return {
      alias: this.alias,
      tables: this.tables,
      selectRowLike: this.selectRowLike,
      whereExpression: this.whereExpression,
      orderByExpressions: this.orderByExpressions,
      limit: this.#limit,
      offset: this.#offset,
      db: this.#db,
      // `rawTable` is set only when created directly from a TableClass
      rawTable: undefined,
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
  opts?: { remapColumns?: boolean }
  // `= () => ` to ensure the method is a direct property of the class instance,
  // not a method of the class prototype
  column = function (this: InstanceType<TableClass<string>>, columnName: string): ColumnReferenceExpression {
    const cls = this.constructor as TableClass<string>
    return new UnboundColumnReferenceExpression(cls.alias ?? cls.tableName, columnName)
  }
}

export type TableClass<N extends string = string> = {
  new(opts?: { remapColumns?: boolean }): TableBase
  as: <T extends TableClass, N2 extends string>(this: T, alias: N2) => Omit<T, keyof TableClass> & TableClass<N2> & {
    new(): InstanceType<T>
  }
  toRowLike: <T extends TableClass>(this: T, opts?: { remapColumns?: boolean }) => InstanceType<T>
  from: <T extends TableClass>(this: T) => QueryBuilder<N, { [k in N]: InstanceType<T> }, InstanceType<T>>
  on: <T extends TableClass>(this: T, on: NamespacedExpression<InstanceType<T>, SqlExpression>) => T
  compile: () => RawSql
  alias: N
  tableName: string
  onExpression?: SqlExpression
}

const table = <N extends string>(db: Database, name: N): TableClass<N> => {
  const { [name]: tableClass } = { [name]: class extends TableBase {
    static readonly tableName: string = name
    static readonly alias: N = name
    static readonly onExpression?: SqlExpression

    constructor(opts?: { remapColumns?: boolean }) {
      super()
      this.opts = opts
    }

    static from<T extends TableClass>(this: T): QueryBuilder<N, { [k in N]: InstanceType<T> }, InstanceType<T>> {
      const tables = { [this.alias]: { fromItem: this, joinType: null, isLateral: false } } as unknown as Tables<{ [k in N]: InstanceType<T> }>
      return new QueryBuilder({ db, alias: this.alias as N, tables, selectRowLike: this.toRowLike(), rawTable: this }) as QueryBuilder<N, { [k in N]: InstanceType<T> }, InstanceType<T>>
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

    // use `function` to bind `this` to the current class instance
    static toRowLike = function <T extends TableClass<string>>(this: T, opts?: { remapColumns?: boolean }): InstanceType<T> {
      const rowLike = new this(opts) as unknown as InstanceType<T>

      // Convert any unbound column references to getters that are bound to the current
      // table alias. This serves two purposes:
      // 1. It allows the columns to be lazily bound to the both the subquery alias and column alias when the row is created.
      // 2. By binding to prototype instead of `this`, it tells Cap'n Web columns can be traversed over RPC.
      for (const key of Object.keys(rowLike)) {
        const value = rowLike[key as keyof typeof rowLike]
        if (value instanceof UnboundColumnReferenceExpression) {
          const proto = Object.getPrototypeOf(rowLike)
          const getter = function (this: InstanceType<TableClass<string>>) {
            const cls = this.constructor as TableClass<string>
            // remapColumns means we've rebound the column to the subquery alias
            return new ColumnReferenceExpression(cls.alias ?? cls.tableName, this.opts?.remapColumns ? key : value.column)
          }
          setToolMetadata(getter, { runtimeValidationEnabled: true })
          Object.defineProperty(proto, key, {
            get: getter,
            enumerable: true,
            configurable: true,
          })
          delete rowLike[key as keyof typeof rowLike]
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

export class Database {
  private kysely?: Kysely<any>
  constructor(private dialect: Dialect, private opts?: { logQuery?: (raw: CompiledQuery) => void }) {}

  async execute(query: RawSql) {
    if (this.kysely == null) {
      this.kysely = new Kysely({ dialect: this.dialect })
    }

    if (this.opts?.logQuery) {
      this.opts.logQuery(query.compile(this.kysely))
    }

    const result = await query.execute(this.kysely)
    return result.rows
  }

  Table<N extends string>(name: N) {
    return table(this, name)
  }
}
