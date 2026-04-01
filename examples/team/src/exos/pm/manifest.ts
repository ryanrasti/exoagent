import type { PiProviderImpl } from 'exoagent/providers/pi'
import type { InboxProviderImpl } from 'exoagent/providers/inbox'

/**
 * PM exo — project manager agent.
 *
 * Consumes: pi (agent runtime), inbox (message queue),
 *   github, linear, matrix (event sources + APIs).
 */
export default {
	'@exoagent/providers/pi': (pi: PiProviderImpl) => pi,
	'@exoagent/providers/inbox': (inbox: InboxProviderImpl) => inbox,
}
