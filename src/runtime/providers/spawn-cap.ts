import { tool } from '../../exoeval/tool'
import { z } from 'zod'

/**
 * Spawn cap — creates agent sessions in dtach.
 * Wraps the daemon's spawn method as a toolable cap.
 */
export class SpawnCap {
  private doSpawn: (id: string) => Promise<string>

  constructor(spawnFn: (id: string) => Promise<string>) {
    this.doSpawn = spawnFn
  }

  @tool(z.object({ id: z.string().describe('Agent session ID') }))
  async create({ id }: { id: string }): Promise<string> {
    return this.doSpawn(id)
  }
}
