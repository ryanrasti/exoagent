import { env } from 'cloudflare:workers'

// Wallet addresses and expected balances
const RAW_SQL_WALLET = { address: 'bc1qg47yfwa62w77ycwnterjml66q24zpdngepurux', expectedSats: 23909 } // ~$20 @ 85k/BTC
const EXOAGENT_WALLET = { address: 'bc1q7jx6ss03qqpmuexe7qyaq07kad4dycr350w4z6', expectedSats: 1176400 } // ~$1000 @ 85k/BTC

async function fetchWalletBalance(address: string, expectedSats: number): Promise<number> {
  try {
    const res = await fetch(`https://blockstream.info/api/address/${address}`, {
      signal: AbortSignal.timeout(2000),
      cf: { cacheTtl: 15, cacheEverything: true },
    })
    if (!res.ok) {
      console.error('blockstream.info returned', res.status)
      return expectedSats
    }
    const data = await res.json() as {
      chain_stats: { funded_txo_sum: number, spent_txo_sum: number }
      mempool_stats: { funded_txo_sum: number, spent_txo_sum: number }
    }
    const confirmedBalance = data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum
    const mempoolBalance = data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum
    return confirmedBalance + mempoolBalance
  }
  catch (error) {
    console.error('Failed to fetch wallet balance from blockstream.info:', error)
    return expectedSats
  }
}

// In-memory cache for stats - shared across requests in the same isolate
export type StatsResult = {
  hackCount: number
  attemptCount: number
  leaderboard: { last24h: Array<{ username: string, claimedAt: string }>, recent: Array<{ username: string, claimedAt: string }> }
  isLive: boolean
  isRawSqlBountyClaimed: boolean
  wallets: {
    rawSql: { balanceSats: number, expectedSats: number, address: string }
    exoagent: { balanceSats: number, expectedSats: number, address: string }
  }
}

let statsPromise: Promise<StatsResult> | null = null
let statsExpiresAt = 0
const STATS_CACHE_TTL_MS = 2000 // 2 second TTL - fresh enough for live updates

export function getStats(db: D1Database): Promise<StatsResult> {
  if (!statsPromise || Date.now() >= statsExpiresAt) {
    statsExpiresAt = Date.now() + STATS_CACHE_TTL_MS
    statsPromise = (async () => {
      const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

      const [counts, last24hHackers, recent, rawSqlBalance, exoagentBalance] = await Promise.all([
        db.prepare(`
          SELECT
            COUNT(*) FILTER (WHERE type = 'raw_sql' AND is_solved) as hack_count,
            SUM(turn_count) FILTER (WHERE type = 'exoagent') as attempt_count
          FROM chat_threads
        `).first<{ hack_count: number, attempt_count: number }>(),
        db.prepare(`
          SELECT claimed_by as username, claimed_at as claimedAt
          FROM chat_threads
          WHERE type = 'raw_sql' AND claimed_at IS NOT NULL AND claimed_at >= ?
          ORDER BY claimed_at ASC
        `).bind(last24h).all<{ username: string, claimedAt: string }>(),
        db.prepare(`
          SELECT claimed_by as username, claimed_at as claimedAt
          FROM chat_threads
          WHERE type = 'raw_sql' AND claimed_at IS NOT NULL
          ORDER BY claimed_at DESC
          LIMIT 20
        `).all<{ username: string, claimedAt: string }>(),
        fetchWalletBalance(RAW_SQL_WALLET.address, RAW_SQL_WALLET.expectedSats),
        fetchWalletBalance(EXOAGENT_WALLET.address, EXOAGENT_WALLET.expectedSats),
      ])

      // Bounty is claimed if: explicit flag OR balance dropped below 10%
      const rawSqlBalancePercent = rawSqlBalance / RAW_SQL_WALLET.expectedSats
      const isRawSqlBountyClaimed = env.RAW_SQL_BOUNTY_CLAIMED === 'true' || rawSqlBalancePercent < 0.1

      return {
        hackCount: counts?.hack_count ?? 0,
        attemptCount: counts?.attempt_count ?? 0,
        leaderboard: {
          last24h: last24hHackers.results ?? [],
          recent: recent.results ?? [],
        },
        isLive: env.CTF_IS_LIVE === 'true',
        isRawSqlBountyClaimed,
        wallets: {
          rawSql: { balanceSats: rawSqlBalance, expectedSats: RAW_SQL_WALLET.expectedSats, address: RAW_SQL_WALLET.address },
          exoagent: { balanceSats: exoagentBalance, expectedSats: EXOAGENT_WALLET.expectedSats, address: EXOAGENT_WALLET.address },
        },
      }
    })()
  }
  return statsPromise
}
