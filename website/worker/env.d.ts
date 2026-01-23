declare namespace Cloudflare {
  interface Env {
    GOOGLE_GENERATIVE_AI_API_KEY: string
    RATE_LIMIT: KVNamespace
    BOUNTY_DB: D1Database // ExoAgent bounty - real $5K key lives here
  }
}

interface Env extends Cloudflare.Env {}
