import type { RawBuilder } from 'kysely'

import { sql as kyselySql } from 'kysely'

export const sql = kyselySql
export type RawSql = RawBuilder<unknown>

export const buildSql = (parts: unknown[], separator: RawSql = kyselySql` `) => {
  return kyselySql.join(parts.filter(x => x != null), separator)
}
