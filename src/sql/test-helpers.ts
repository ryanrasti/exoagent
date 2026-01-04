import type { RawSql } from './sql'
// from https://kysely.dev/docs/recipes/splitting-query-building-and-execution:
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely'

const db = new Kysely<unknown>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: db => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
})

export const compiledQuery = (query: RawSql) => {
  const { sql, parameters } = query.compile(db)
  return { sql, parameters }
}
