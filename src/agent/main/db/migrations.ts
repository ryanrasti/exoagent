import type { Kysely, Migration, MigrationProvider } from 'kysely'
import { Migrator } from 'kysely'

// Import migrations
import * as m001 from './migrations/001_initial'
import * as m002 from './migrations/002_subthreads'
import * as m003 from './migrations/003_scope'

// Custom migration provider that uses imported modules
class StaticMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return {
      '001_initial': m001,
      '002_subthreads': m002,
      '003_scope': m003,
    }
  }
}

export async function migrate(db: Kysely<unknown>): Promise<void> {
  console.log('[migrate] Starting migrations...')

  const migrator = new Migrator({
    db,
    provider: new StaticMigrationProvider(),
    allowUnorderedMigrations: true,
  })

  const { error, results } = await migrator.migrateToLatest()

  results?.forEach((it) => {
    if (it.status === 'Success') {
      console.log(`[migrate] Migration "${it.migrationName}" executed successfully`)
    }
    else if (it.status === 'Error') {
      console.error(`[migrate] Failed to execute migration "${it.migrationName}"`)
    }
  })

  if (error) {
    console.error('[migrate] Migration failed:', error)
    throw error
  }

  console.log('[migrate] All migrations complete')
}
