import { tool } from '../../exoeval/tool'
import { z } from 'zod'

/**
 * Attach cap — attaches the current terminal to an agent's dtach session.
 * Wraps the daemon's attach method as a toolable cap.
 */
export class AttachCap {
  private doAttach: (id: string) => void

  constructor(attachFn: (id: string) => void) {
    this.doAttach = attachFn
  }

  @tool(z.object({ id: z.string().describe('Agent session ID to attach to') }))
  async connect({ id }: { id: string }): Promise<void> {
    this.doAttach(id)
  }
}
