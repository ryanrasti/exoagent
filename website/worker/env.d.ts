declare namespace Cloudflare {
  interface Env {
    GOOGLE_GENERATIVE_AI_API_KEY: string
    EXOAGENT_RATE_LIMIT: KVNamespace
    EXOAGENT_BOUNTY_DB: D1Database // ExoAgent bounty - real $5K key lives here
  }
}

interface Env extends Cloudflare.Env {}
