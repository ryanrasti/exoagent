import { tool } from '../../exoeval/tool'
import { z } from 'zod'

/**
 * Args cap — provides CLI arguments to exos.
 */
export class ArgsCap {
  private map: Map<string, string | true>

  constructor(args: string[]) {
    this.map = new Map()
    for (let i = 0; i < args.length; i++) {
      if (args[i].startsWith('--')) {
        const key = args[i].slice(2)
        const next = args[i + 1]
        if (next && !next.startsWith('--')) {
          this.map.set(key, next)
          i++
        }
        else {
          this.map.set(key, true)
        }
      }
    }
  }

  @tool(z.object({ key: z.string() }))
  async get({ key }: { key: string }): Promise<string | undefined> {
    const v = this.map.get(key)
    return typeof v === 'string' ? v : undefined
  }

  @tool(z.object({ key: z.string() }))
  async has({ key }: { key: string }): Promise<boolean> {
    return this.map.has(key)
  }
}
