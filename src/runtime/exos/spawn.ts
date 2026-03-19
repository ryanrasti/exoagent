import type { ArgsCap } from '../providers/args'

/**
 * Spawn exo — creates a coding agent and optionally attaches.
 *
 * Args:
 *   --id <name>     Agent ID (default: "default")
 *   --no-attach     Don't attach after spawning
 *
 * SpawnCap and AttachCap are inlined in daemon.ts.
 */

export default async ({ spawn, args, attach }: {
  spawn: { create: (params: { id: string }) => Promise<string> }
  args: ArgsCap
  attach: { connect: (params: { id: string }) => Promise<void> }
}) => {
  const idArg = await args.get({ key: 'id' })
  const id = idArg ?? 'default'
  await spawn.create({ id })
  const noAttach = await args.has({ key: 'no-attach' })
  if (!noAttach) {
    await attach.connect({ id })
  }
  return id
}
