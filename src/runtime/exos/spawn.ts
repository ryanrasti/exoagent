import type { ArgsCap } from '../providers/args'
import type { AttachCap } from '../providers/attach-cap'
/**
 * Spawn exo — creates a coding agent and optionally attaches.
 *
 * Args:
 *   --id <name>     Agent ID (default: "default")
 *   --no-attach     Don't attach after spawning
 */
import type { SpawnCap } from '../providers/spawn-cap'

export default async ({ spawn, args, attach }: {
  spawn: SpawnCap
  args: ArgsCap
  attach: AttachCap
}) => {
  const idArg = await args.get({ key: 'id' })
  const id = idArg ?? 'default'
  await spawn.create({ id })
  const noAttach = await args.has({ key: 'no-attach' })
  if (!noAttach)
    await attach.connect({ id })
  return id
}
