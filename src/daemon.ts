/**
 * exoagentd — daemon entry point.
 *
 * Initializes providers and starts the HTTP server.
 */

import { GitHubProvider } from './providers/github'
import { startServer } from './server'

const port = Number(process.env.PORT) || 3000

const providers = {
	github: { instance: new GitHubProvider() },
}

startServer(providers, port)
