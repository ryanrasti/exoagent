declare namespace Cloudflare {
  interface Env {
    GOOGLE_GENERATIVE_AI_API_KEY: string
    EXOAGENT_BOUNTY_DB: D1Database // ExoAgent bounty - real $1K key lives here
    EXOAGENT_SESSIONS_DB: D1Database // Sessions database - separate from bounty
    TURNSTILE_SECRET_KEY: string
    RAW_SQL_BOUNTY_KEY: string // BTC private key for raw SQL $20 bounty
    CTF_IS_LIVE: string // 'true' when CTF is live, controls preview mode
    RAW_SQL_BOUNTY_CLAIMED: string // 'true' when raw SQL bounty has been claimed (manual override)
  }
}

interface Env extends Cloudflare.Env {}
