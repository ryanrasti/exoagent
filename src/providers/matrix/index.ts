/**
 * Matrix provider — messaging via Matrix client-server API.
 *
 * Depends on (via manifest.ts):
 *   - config: for homeserver URL, access token, default room ID
 *   - fetch: for making HTTP requests to the Matrix homeserver
 *
 * Setup instructions:
 * 1. Create a Matrix account (e.g., on matrix.org via Element)
 * 2. Create an access token: Element → Settings → Help & About → Access Token
 *    Or via API: POST /_matrix/client/v3/login
 * 3. Create a private room for agent communication
 * 4. Set homeserver_url, access_token, and room_id in the config UI
 */

import type { BoundEval } from '../../bound-eval'
import type { ProviderInit } from '../../provider'
import type { ScopedConfig } from '../config'
import type { FetchResponse, ScopedFetch } from '../fetch'
import z from 'zod'
import { tool } from '../../exoeval/tool'

type MatrixCaps = {
	config: ScopedConfig
	fetch: ScopedFetch
}

type MatrixMessage = {
	event_id: string
	sender: string
	body: string
	timestamp: number
}

export type MatrixProviderImpl = InstanceType<typeof MatrixProvider>

class MatrixProvider {
	private readonly exoEval: BoundEval<MatrixCaps>
	private syncToken: string | null = null

	constructor(exoEval: BoundEval<MatrixCaps>) {
		this.exoEval = exoEval

		this.exoEval(({ config }) =>
			config.setSchema({
				homeserver_url: {
					type: 'string',
					isRequired: true,
					description: 'Matrix homeserver URL, e.g., https://matrix.org',
				},
				access_token: {
					type: 'string',
					isRequired: true,
					isSecret: true,
					description: 'Matrix access token. Get from Element → Settings → Help & About → Access Token',
				},
				room_id: {
					type: 'string',
					isRequired: true,
					description: 'Room ID for agent messages, e.g., !abc123:matrix.org',
				},
			}),
		)
	}

	private getConfig(): { homeserverUrl: string, accessToken: string, roomId: string } {
		const homeserverUrl = this.exoEval(({ config }) => config.get('homeserver_url')) as string | null
		const accessToken = this.exoEval(({ config }) => config.get('access_token')) as string | null
		const roomId = this.exoEval(({ config }) => config.get('room_id')) as string | null

		if (!homeserverUrl) { throw new Error('homeserver_url not configured') }
		if (!accessToken) { throw new Error('access_token not configured') }
		if (!roomId) { throw new Error('room_id not configured') }

		return {
			homeserverUrl: homeserverUrl.replace(/\/$/, ''),
			accessToken,
			roomId,
		}
	}

	private async matrixFetch(path: string, options?: { method?: string, body?: string }): Promise<unknown> {
		const { homeserverUrl, accessToken } = this.getConfig()
		const url = `${homeserverUrl}${path}`
		const method = options?.method ?? 'GET'
		const body = options?.body
		const headers: { [key: string]: string } = {
			'Authorization': `Bearer ${accessToken}`,
			'Content-Type': 'application/json',
		}

		const res = (await this.exoEval(
			({ fetch }) => fetch.fetch(url, { method, headers, body }),
			{ url, method, headers, body },
		)) as FetchResponse

		if (res.status >= 400) {
			throw new Error(`Matrix API error ${res.status}: ${res.body}`)
		}

		return JSON.parse(res.body)
	}

	@tool(z.string(), z.string().optional())
	async sendMessage(body: string, roomId?: string): Promise<{ event_id: string }> {
		const config = this.getConfig()
		const room = roomId ?? config.roomId
		const txnId = `exo_${Date.now()}_${Math.random().toString(36).slice(2)}`

		const result = await this.matrixFetch(
			`/_matrix/client/v3/rooms/${encodeURIComponent(room)}/send/m.room.message/${txnId}`,
			{
				method: 'PUT',
				body: JSON.stringify({ msgtype: 'm.text', body }),
			},
		) as { event_id: string }

		return { event_id: result.event_id }
	}

	@tool(z.number().optional(), z.string().optional())
	async getMessages(limit?: number, roomId?: string): Promise<MatrixMessage[]> {
		const config = this.getConfig()
		const room = roomId ?? config.roomId
		const n = limit ?? 10

		const data = await this.matrixFetch(
			`/_matrix/client/v3/rooms/${encodeURIComponent(room)}/messages?dir=b&limit=${n}`,
		) as { chunk: { event_id: string, sender: string, content: { body?: string, msgtype?: string }, origin_server_ts: number }[] }

		return data.chunk
			.filter(e => e.content?.msgtype === 'm.text')
			.map(e => ({
				event_id: e.event_id,
				sender: e.sender,
				body: e.content.body ?? '',
				timestamp: e.origin_server_ts,
			}))
	}

	@tool()
	async whoami(): Promise<{ user_id: string }> {
		const result = await this.matrixFetch('/_matrix/client/v3/account/whoami') as { user_id: string }
		return { user_id: result.user_id }
	}

	@tool()
	async listJoinedRooms(): Promise<{ room_id: string }[]> {
		const data = await this.matrixFetch('/_matrix/client/v3/joined_rooms') as { joined_rooms: string[] }
		return data.joined_rooms.map(r => ({ room_id: r }))
	}

	clientProvider(_clientName: string): MatrixProviderImpl {
		return this
	}

	uiProvider(_clients: string[]) {
		return this
	}
}

export default ({ exoEval }: ProviderInit<MatrixCaps>) => new MatrixProvider(exoEval)
