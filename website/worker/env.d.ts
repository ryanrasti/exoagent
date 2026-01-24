declare namespace Cloudflare {
  interface Env {
    GOOGLE_GENERATIVE_AI_API_KEY: string
    EXOAGENT_RATE_LIMIT: KVNamespace
    EXOAGENT_BOUNTY_DB: D1Database // ExoAgent bounty - real $5K key lives here
    EXOAGENT_SESSIONS_DB: D1Database // Sessions database - separate from bounty
    TURNSTILE_SECRET_KEY: string
  }
}

interface Env extends Cloudflare.Env {}
