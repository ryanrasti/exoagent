import type { GithubProviderImpl } from 'exoagent/providers/github'
import type { MatrixProviderImpl } from 'exoagent/providers/matrix'
import type { PiProviderImpl } from 'exoagent/providers/pi'

/**
 * PM exo — project manager agent.
 *
 * Consumes: pi (agent runtime), github, matrix (APIs).
 * Inbox is built into pi — agents get it automatically.
 */
export default {
	'@exoagent/providers/github': (github: GithubProviderImpl) => github,
	'@exoagent/providers/matrix': (matrix: MatrixProviderImpl) => matrix,
	'@exoagent/providers/pi': (pi: PiProviderImpl) => pi,
}
