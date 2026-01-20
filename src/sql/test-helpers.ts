import type { Dialect } from 'kysely'
import type { RawSql } from './sql'
import { PGlite } from '@electric-sql/pglite'
// from https://kysely.dev/docs/recipes/splitting-query-building-and-execution:
import {

  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely'
import { PGliteDialect } from 'kysely-pglite-dialect'

export const pgliteDialect = new PGliteDialect(new PGlite())

export const dummyDialect: Dialect = {
  createAdapter: () => new PostgresAdapter(),
  createDriver: () => new DummyDriver(),
  createIntrospector: db => new PostgresIntrospector(db),
  createQueryCompiler: () => new PostgresQueryCompiler(),
}

const db = new Kysely<unknown>({
  dialect: dummyDialect,
})

export const compiledQuery = (query: RawSql) => {
  const { sql, parameters } = query.compile(db)
  return { sql, parameters }
}
