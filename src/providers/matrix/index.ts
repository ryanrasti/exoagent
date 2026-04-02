/**
 * Matrix provider — E2EE messaging via matrix-js-sdk.
 *
 * Uses a Space as the workspace boundary. All rooms are scoped to the space.
 * Messages are end-to-end encrypted via the Rust crypto SDK (Megolm/Olm).
 *
 * The SDK is loaded via ring0 (outside SES compartment) since it needs
 * WebAssembly, fetch, and IndexedDB globals.
 *
 * Setup instructions:
 * 1. Create a Matrix account (e.g., on matrix.org via Element)
 * 2. Create an access token: Element → Settings → Help & About → Access Token
 * 3. Create a private Space for your workspace
 * 4. Set homeserver_url, access_token, and space_id in the config UI
 */

import type { createClient as CreateClientFn, MatrixClient, MemoryStore as MemoryStoreCls } from 'matrix-js-sdk'
import type { BoundEval } from '../../bound-eval'
import type { ProviderInit } from '../../provider'
import type { ScopedConfig } from '../config'
import z from 'zod'
import { tool } from '../../exoeval/tool'

type MatrixCaps = {
	config: ScopedConfig
}

type MatrixRing0 = {
	createClient: typeof CreateClientFn
	MemoryStore: typeof MemoryStoreCls
	readFileSync: (path: string, encoding: string) => string
	writeFileSync: (path: string, data: string) => void
	mkdirSync: (path: string, opts?: { recursive?: boolean }) => void
	resolve: (...paths: string[]) => string
	restoreCryptoStore: (path: string) => Promise<void>
	saveCryptoStore: (path: string) => Promise<void>
}

type MatrixMessage = {
	event_id: string
	sender: string
	body: string
	timestamp: number
}

type MatrixRoom = {
	room_id: string
	name: string
	topic: string
}

export type MatrixProviderImpl = InstanceType<typeof MatrixProvider>

type MessageCallback = (msg: { event_id: string, room_id: string, sender: string, body: string }) => void

class MatrixProvider {
	private readonly exoEval: BoundEval<MatrixCaps>
	private readonly ring0: MatrixRing0
	private readonly dataDir: string
	private client: MatrixClient | null = null
	private initPromise: Promise<void> | null = null
	private messageCallbacks: MessageCallback[] = []
	private botUserId: string | null = null

	constructor(exoEval: BoundEval<MatrixCaps>, ring0: MatrixRing0, dataDir: string) {
		this.exoEval = exoEval
		this.ring0 = ring0
		this.dataDir = dataDir

		this.exoEval.run(({ config }) =>
			config.setSchema({
				homeserver_url: {
					type: 'string',
					isRequired: true,
					description: 'Matrix homeserver URL',
					default: 'https://matrix.org',
				},
				access_token: {
					type: 'string',
					isRequired: true,
					isSecret: true,
					description: 'Matrix access token. Get from Element → Settings → Help & About → Access Token',
				},
				space_id: {
					type: 'string',
					isRequired: true,
					description: 'Space ID for the workspace, e.g., !abc123:matrix.org. Create a Space in Element → left sidebar → +',
				},
			}),
		)
	}

	private getConfig(): { homeserverUrl: string, accessToken: string, spaceId: string } {
		const homeserverUrl = this.exoEval.run(({ config }) => config.get('homeserver_url')) as string | null
		const accessToken = this.exoEval.run(({ config }) => config.get('access_token')) as string | null
		const spaceId = this.exoEval.run(({ config }) => config.get('space_id')) as string | null

		if (!homeserverUrl) { throw new Error('homeserver_url not configured') }
		if (!accessToken) { throw new Error('access_token not configured') }
		if (!spaceId) { throw new Error('space_id not configured') }

		return {
			homeserverUrl: homeserverUrl.replace(/\/$/, ''),
			accessToken,
			spaceId,
		}
	}

	private async ensureClient(): Promise<MatrixClient> {
		if (this.client) { return this.client }
		if (this.initPromise) { await this.initPromise; return this.client! }

		this.initPromise = this.initClient()
		await this.initPromise
		return this.client!
	}

	private get cryptoStorePath(): string {
		const dir = this.ring0.resolve(this.dataDir, 'matrix')
		this.ring0.mkdirSync(dir, { recursive: true })
		return this.ring0.resolve(dir, 'crypto-store.json')
	}

	private async initClient(): Promise<void> {
		const { homeserverUrl, accessToken } = this.getConfig()
		const { createClient, MemoryStore } = this.ring0

		const tempClient = createClient({ baseUrl: homeserverUrl, accessToken })
		const whoami = await tempClient.whoami() as { user_id: string, device_id: string }

		const storePrefix = `exoagent-${whoami.user_id}`

		this.client = createClient({
			baseUrl: homeserverUrl,
			userId: whoami.user_id,
			accessToken,
			deviceId: whoami.device_id,
			store: new MemoryStore(),
		})

		// Restore crypto store data BEFORE initRustCrypto.
		// The restore creates IndexedDB stores with correct version.
		// initRustCrypto then opens the DB, finds it at the right version,
		// and reads the existing data (device keys, sessions, etc.)
		await this.ring0.restoreCryptoStore(this.cryptoStorePath)
		await this.client.initRustCrypto({ cryptoDatabasePrefix: storePrefix })

		await this.client.startClient({ initialSyncLimit: 1 })

		await new Promise<void>((resolve) => {
			this.client!.once('sync' as any, () => resolve())
		})

		// Persist crypto store after initial sync
		await this.ring0.saveCryptoStore(this.cryptoStorePath)

		this.botUserId = whoami.user_id

		// Get joined rooms for filtering
		const joinedRooms = this.client.getRooms().map(r => r.roomId)
		console.error(`[matrix] sync complete, joined ${joinedRooms.length} rooms`)

		// Listen on both Event.decrypted (for E2EE rooms) and Room.timeline (for unencrypted)
		const handleMessage = (event: any) => {
			if (this.messageCallbacks.length === 0) { return }
			if (event.getType() !== 'm.room.message') { return }
			const content = event.getContent()
			if (event.getSender() === this.botUserId) { return }

			// Accept m.text or m.bad.encrypted (decryption failed — still deliver)
			const body = content?.msgtype === 'm.text'
				? (content.body ?? '')
				: content?.msgtype === 'm.bad.encrypted'
					? '[unable to decrypt]'
					: null
			if (body === null) { return }

			const msg = {
				event_id: event.getId(),
				room_id: event.getRoomId(),
				sender: event.getSender(),
				body,
			}

			console.error(`[matrix] message from ${msg.sender}: ${msg.body.slice(0, 50)}`)
			for (const cb of this.messageCallbacks) {
				try { cb(msg) }
				catch (e) { console.error(`[matrix] callback error:`, e) }
			}
		}
		this.client.on('Event.decrypted' as any, handleMessage)
		this.client.on('Room.timeline' as any, (event: any, _room: any, toStartOfTimeline: boolean) => {
			if (toStartOfTimeline) { return }
			// Only handle unencrypted messages here (encrypted ones go through Event.decrypted)
			if (event.isEncrypted()) { return }
			handleMessage(event)
		})
	}

	/** List rooms in the workspace space. */
	@tool()
	async listRooms(): Promise<MatrixRoom[]> {
		const client = await this.ensureClient()
		const { spaceId } = this.getConfig()

		const data = await client.getRoomHierarchy(spaceId, 50) as { rooms: { room_id: string, name?: string, topic?: string, room_type?: string }[] }

		return data.rooms
			.filter(r => r.room_id !== spaceId && r.room_type !== 'm.space')
			.map(r => ({
				room_id: r.room_id,
				name: r.name ?? '',
				topic: r.topic ?? '',
			}))
	}

	/** Create a room inside the workspace space. */
	@tool(z.string(), z.string().optional())
	async createRoom(name: string, topic?: string): Promise<{ room_id: string }> {
		const client = await this.ensureClient()
		const { spaceId } = this.getConfig()
		const via = [spaceId.split(':')[1]]

		const createOpts: { [key: string]: unknown } = {
			name,
			visibility: 'private' as const,
			preset: 'private_chat' as const,
			initial_state: [
				{
					type: 'm.space.parent',
					state_key: spaceId,
					content: { canonical: true, via },
				},
			],
		}
		if (topic) { createOpts.topic = topic }

		const result = await client.createRoom(createOpts as any)

		// Add room as child of space
		await client.sendStateEvent(spaceId, 'm.space.child' as any, { via }, result.room_id)

		return { room_id: result.room_id }
	}

	/** Send an encrypted message to a room in the workspace. */
	@tool(z.string(), z.string())
	async sendMessage(roomId: string, body: string): Promise<{ event_id: string }> {
		const client = await this.ensureClient()
		const res = await client.sendTextMessage(roomId, body)
		// Persist room keys after sending (new Megolm session may have been created)
		await this.ring0.saveCryptoStore(this.cryptoStorePath)
		return { event_id: res.event_id }
	}

	/** Get recent messages from a room (decrypted). */
	@tool(z.string(), z.number().optional())
	async getMessages(roomId: string, limit?: number): Promise<MatrixMessage[]> {
		const client = await this.ensureClient()
		const n = limit ?? 10

		const room = client.getRoom(roomId)
		if (!room) { throw new Error(`Room ${roomId} not found — bot may not have joined`) }

		const timeline = room.getLiveTimeline()
		const events = timeline.getEvents().slice(-n)

		return events
			.filter(e => e.getType() === 'm.room.message' && e.getContent().msgtype === 'm.text')
			.map(e => ({
				event_id: e.getId()!,
				sender: e.getSender()!,
				body: e.getContent().body ?? '',
				timestamp: e.getTs(),
			}))
	}

	/** Get the bot's user ID. */
	@tool()
	async whoami(): Promise<{ user_id: string }> {
		const client = await this.ensureClient()
		const res = await client.whoami()
		return { user_id: res.user_id }
	}

	/**
	 * Register a callback for new messages in workspace rooms.
	 * Ignores messages from the bot itself.
	 * Callback receives { event_id, room_id, sender, body }.
	 */
	@tool(z.any())
	onMessage(callback: MessageCallback): void {
		console.error('[matrix] onMessage called, this exists:', !!this, 'callbacks:', this?.messageCallbacks?.length)
		this.messageCallbacks.push(callback)
		// Ensure the client is running so sync events fire
		this.ensureClient().catch((e) => { console.error('[matrix] ensureClient failed:', e) })
	}

	clientProvider(_clientName: string): MatrixProviderImpl {
		return this
	}

	uiProvider(_clients: string[]) {
		return this
	}
}

export default ({ exoEval, ring0, config }: ProviderInit<MatrixCaps>) =>
	new MatrixProvider(exoEval, ring0 as MatrixRing0, config.dataDir)
