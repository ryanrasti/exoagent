/**
 * PM exo — project manager agent.
 *
 * Creates a pi agent with access to linear, matrix, and github caps.
 * Sets up event subscriptions so incoming messages are delivered to the inbox.
 * The daemon steers the agent when new messages arrive.
 *
 * For v0: just creates the agent and leaves it running.
 * Event subscriptions (linear.onIssueCreated, matrix.onMessage) will be
 * wired up when those providers support them.
 */

import type { BoundEval } from 'exoagent/bound-eval'
import type { PiProviderImpl } from 'exoagent/providers/pi'
import type { InboxProviderImpl } from 'exoagent/providers/inbox'

type PmCaps = {
	pi: PiProviderImpl
	inbox: InboxProviderImpl
}

export default async ({ exoEval }: { exoEval: BoundEval<PmCaps> }) => {
	console.log('[pm] creating project manager agent...')

	// Create pi agent with linear, matrix, github cap types available
	const result = await exoEval(
		({ pi }) => pi.create('pm', 'main', capNames),
		{ capNames: ['github', 'linear', 'matrix'] },
	)
	console.log('[pm] agent ready:', result)

	// TODO: wire up event subscriptions when providers support them
	// await exoEval(({ linear, inbox }) =>
	//   linear.onIssueCreated(issue =>
	//     inbox.deliver('main', 'linear', `New issue: ${issue.title}`)
	//   )
	// )
}
