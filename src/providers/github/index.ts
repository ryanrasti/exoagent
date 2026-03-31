/**
 * GitHub provider — exposes GitHub API operations as @tool() methods.
 */

import z from 'zod'
import { tool } from '../../exoeval/tool'

export class GitHubProvider {
	private token: string | null = null

	/**
	 * Set the GitHub personal access token.
	 */
	@tool(z.string())
	setToken(token: string): { ok: true } {
		this.token = token
		return { ok: true }
	}

	/**
	 * Test the connection by fetching the authenticated user.
	 */
	@tool()
	async testConnection(): Promise<{ login: string; id: number; name: string | null }> {
		if (!this.token) {
			throw new Error('no token configured')
		}
		const res = await fetch('https://api.github.com/user', {
			headers: {
				'Authorization': `Bearer ${this.token}`,
				'User-Agent': 'exoagent',
				'Accept': 'application/vnd.github+json',
			},
		})
		if (!res.ok) {
			const body = await res.text()
			throw new Error(`GitHub API error ${res.status}: ${body}`)
		}
		const user = await res.json() as { login: string; id: number; name: string | null }
		return { login: user.login, id: user.id, name: user.name }
	}

	/**
	 * Get a user by username.
	 */
	@tool(z.string())
	async getUser(username: string): Promise<{ login: string; id: number; name: string | null }> {
		if (!this.token) {
			throw new Error('no token configured')
		}
		const res = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}`, {
			headers: {
				'Authorization': `Bearer ${this.token}`,
				'User-Agent': 'exoagent',
				'Accept': 'application/vnd.github+json',
			},
		})
		if (!res.ok) {
			const body = await res.text()
			throw new Error(`GitHub API error ${res.status}: ${body}`)
		}
		const user = await res.json() as { login: string; id: number; name: string | null }
		return { login: user.login, id: user.id, name: user.name }
	}
}
