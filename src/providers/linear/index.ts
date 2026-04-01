/**
 * Linear provider — project management via Linear's GraphQL API.
 *
 * Depends on (via manifest.ts):
 *   - config: for storing/retrieving the Linear API key
 *   - fetch: for making HTTP requests to api.linear.app
 */

import type { BoundEval } from '../../bound-eval'
import type { ProviderInit } from '../../provider'
import type { ScopedConfig } from '../config'
import type { FetchResponse, ScopedFetch } from '../fetch'
import z from 'zod'
import { tool } from '../../exoeval/tool'

type LinearCaps = {
	config: ScopedConfig
	fetch: ScopedFetch
}

type GraphQLResponse = {
	data?: unknown
	errors?: { message: string }[]
}

export type LinearProviderImpl = InstanceType<typeof LinearProvider>

class LinearProvider {
	private readonly exoEval: BoundEval<LinearCaps>

	constructor(exoEval: BoundEval<LinearCaps>) {
		this.exoEval = exoEval

		// Register config schema
		this.exoEval(({ config }) =>
			config.setSchema({
				api_key: {
					type: 'string',
					isRequired: true,
					isSecret: true,
					description: 'Linear API key. [Create one](https://linear.app/settings/api)',
				},
			}),
		)
	}

	private async graphql(query: string, variables?: { [key: string]: unknown }): Promise<unknown> {
		const apiKey = this.exoEval(({ config }) => config.get('api_key')) as string | null
		if (!apiKey) {
			throw new Error('no API key configured — set it in the config UI')
		}

		const body = JSON.stringify({ query, variables })
		const headers = {
			'Content-Type': 'application/json',
			'Authorization': apiKey,
		}
		const url = 'https://api.linear.app/graphql'

		const res = (await this.exoEval(
			({ fetch }) => fetch.fetch(url, { method: 'POST', headers, body }),
			{ url, headers, body },
		)) as FetchResponse

		if (res.status !== 200) {
			throw new Error(`Linear API error ${res.status}: ${res.body}`)
		}

		const parsed = JSON.parse(res.body) as GraphQLResponse
		if (parsed.errors?.length) {
			throw new Error(`Linear GraphQL error: ${parsed.errors.map(e => e.message).join(', ')}`)
		}

		return parsed.data
	}

	@tool()
	async getViewer(): Promise<{ id: string, name: string, email: string }> {
		const data = await this.graphql(`query { viewer { id name email } }`) as {
			viewer: { id: string, name: string, email: string }
		}
		return data.viewer
	}

	@tool(z.string().optional(), z.number().optional())
	async listIssues(teamKey?: string, limit?: number): Promise<{ id: string, title: string, state: { name: string }, priority: number, identifier: string }[]> {
		const first = limit ?? 25
		const filter = teamKey ? `, filter: { team: { key: { eq: "${teamKey}" } } }` : ''
		const data = await this.graphql(`query {
			issues(first: ${first}${filter}, orderBy: updatedAt) {
				nodes { id title identifier priority state { name } }
			}
		}`) as { issues: { nodes: { id: string, title: string, state: { name: string }, priority: number, identifier: string }[] } }
		return data.issues.nodes
	}

	@tool(z.string())
	async getIssue(issueId: string): Promise<{ id: string, title: string, description: string | null, state: { name: string }, priority: number, identifier: string, assignee: { name: string } | null }> {
		const data = await this.graphql(`query($id: String!) {
			issue(id: $id) { id title description identifier priority state { name } assignee { name } }
		}`, { id: issueId }) as { issue: { id: string, title: string, description: string | null, state: { name: string }, priority: number, identifier: string, assignee: { name: string } | null } }
		return data.issue
	}

	@tool(z.string(), z.string(), z.string().optional(), z.number().optional())
	async createIssue(teamId: string, title: string, description?: string, priority?: number): Promise<{ id: string, identifier: string, url: string }> {
		const input: { [key: string]: unknown } = { teamId, title }
		if (description) { input.description = description }
		if (priority !== undefined) { input.priority = priority }

		const data = await this.graphql(`mutation($input: IssueCreateInput!) {
			issueCreate(input: $input) {
				success
				issue { id identifier url }
			}
		}`, { input }) as { issueCreate: { success: boolean, issue: { id: string, identifier: string, url: string } } }
		return data.issueCreate.issue
	}

	@tool(z.string(), z.string())
	async addComment(issueId: string, body: string): Promise<{ id: string }> {
		const data = await this.graphql(`mutation($input: CommentCreateInput!) {
			commentCreate(input: $input) {
				success
				comment { id }
			}
		}`, { input: { issueId, body } }) as { commentCreate: { success: boolean, comment: { id: string } } }
		return data.commentCreate.comment
	}

	@tool(z.string(), z.string())
	async updateIssueState(issueId: string, stateId: string): Promise<{ success: boolean }> {
		const data = await this.graphql(`mutation($id: String!, $input: IssueUpdateInput!) {
			issueUpdate(id: $id, input: $input) { success }
		}`, { id: issueId, input: { stateId } }) as { issueUpdate: { success: boolean } }
		return data.issueUpdate
	}

	@tool()
	async listTeams(): Promise<{ id: string, name: string, key: string }[]> {
		const data = await this.graphql(`query {
			teams { nodes { id name key } }
		}`) as { teams: { nodes: { id: string, name: string, key: string }[] } }
		return data.teams.nodes
	}

	@tool(z.string())
	async listStates(teamId: string): Promise<{ id: string, name: string, type: string }[]> {
		const data = await this.graphql(`query($teamId: String!) {
			workflowStates(filter: { team: { id: { eq: $teamId } } }) {
				nodes { id name type }
			}
		}`, { teamId }) as { workflowStates: { nodes: { id: string, name: string, type: string }[] } }
		return data.workflowStates.nodes
	}

	clientProvider(_clientName: string): LinearProviderImpl {
		return this
	}

	uiProvider(_clients: string[]) {
		return this
	}
}

export default ({ exoEval }: ProviderInit<LinearCaps>) => new LinearProvider(exoEval)
