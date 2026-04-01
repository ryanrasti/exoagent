import type { GithubProviderImpl } from 'exoagent/providers/github'
import type { InboxProviderImpl } from 'exoagent/providers/inbox'
import type { MatrixProviderImpl } from 'exoagent/providers/matrix'
import type { PiProviderImpl } from 'exoagent/providers/pi'

/**
 * PM exo — project manager agent.
 *
 * Consumes: pi (agent runtime), inbox (message queue),
 *   github, matrix (event sources + APIs).
 */
export default {
	'@exoagent/providers/pi': (pi: PiProviderImpl) => pi,
	'@exoagent/providers/inbox': (inbox: InboxProviderImpl) => inbox,
	'@exoagent/providers/matrix': (matrix: MatrixProviderImpl) => matrix,
	'@exoagent/providers/github': (github: GithubProviderImpl) => github,
}
