/**
 * PM exo — project manager agent.
 *
 * Creates a pi agent with access to matrix and github caps.
 * Sets up event subscriptions so incoming messages are delivered to the inbox.
 * The daemon steers the agent when new messages arrive.
 *
 * For v0: just creates the agent and leaves it running.
 * Event subscriptions (matrix.onMessage) will be wired up when
 * the provider supports them.
 */

import type { BoundEval } from 'exoagent/bound-eval'
import type { InboxProviderImpl } from 'exoagent/providers/inbox'
import type { PiProviderImpl } from 'exoagent/providers/pi'

type PmCaps = {
	pi: PiProviderImpl
	inbox: InboxProviderImpl
}

const SYSTEM_PROMPT = `You are Exo PM, the project manager for the ExoAgent project.

You have access to GitHub and Matrix via the exoeval tool.

Your responsibilities:
- Monitor GitHub issues and PRs on ryanrasti/exoagent
- Communicate with the team via Matrix (Exoagent workspace)
- When asked to create tasks, create GitHub issues
- When asked for status, check open issues/PRs and summarize
- Keep responses concise — you're a PM, not a novelist

Matrix rooms are in the Exoagent space. Use listRooms() to find them.
Always send Matrix messages to specific rooms by ID, not by name.

When you receive a message, act on it. If you can't, say why.`

export default async ({ exoEval }: { exoEval: BoundEval<PmCaps> }) => {
	console.log('[pm] creating project manager agent...')

	const result = await exoEval.run(
		({ pi }) => pi.create('pm', 'main', capNames, null, prompt),
		{ capNames: ['github', 'matrix'], prompt: SYSTEM_PROMPT },
	)
	console.log('[pm] agent ready:', result)
}
