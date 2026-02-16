import { z } from 'zod'
import { ExoAgent } from '../../policy'

// ExoAgent for Slack with message as both source and sink
export const slackExo = new ExoAgent(['slack'] as const, ['slack'] as const)

export interface SlackMessage {
  id: string
  channelId: string
  channelName: string
  userId: string
  userName: string
  text: string
  timestamp: string
  threadTs?: string
  principals: SlackPrincipals
}

export interface SlackPrincipals {
  /** User who sent the message */
  user: string
  /** Channel where message was posted */
  channel: string
  /** All users who have access to this channel */
  channelMembers: string[]
  /** All principals (user + channel members) */
  all: string[]
}

export interface SlackChannel {
  id: string
  name: string
  isPrivate: boolean
  members: string[]
}

/** Interface for Slack operations */
export interface ISlack {
  listChannels(): Promise<SlackChannel[]>
  getChannel(opts: { channelId: string }): Promise<SlackChannel>
  listMessages(opts: { channelId: string, limit?: number }): Promise<SlackMessage[]>
  getMessage(opts: { channelId: string, messageId: string }): Promise<SlackMessage>
  sendMessage(opts: { channelId: string, text: string, threadTs?: string }): Promise<{ success: boolean, id: string }>
  sendDM(opts: { userId: string, text: string }): Promise<{ success: boolean, id: string }>
}

const listMessagesSchema = z.object({
  channelId: z.string(),
  limit: z.number().optional(),
})

const getMessageSchema = z.object({
  channelId: z.string(),
  messageId: z.string(),
})

const sendMessageSchema = z.object({
  channelId: z.string(),
  text: z.string(),
  threadTs: z.string().optional(),
})

const sendDMSchema = z.object({
  userId: z.string(),
  text: z.string(),
})

/** Default seed data for mock Slack */
export const MOCK_SLACK_SEED: { channels: SlackChannel[], messages: SlackMessage[] } = {
  channels: [
    {
      id: 'C001',
      name: 'general',
      isPrivate: false,
      members: ['U001', 'U002', 'U003', 'me'],
    },
    {
      id: 'C002',
      name: 'engineering',
      isPrivate: false,
      members: ['U001', 'U002', 'me'],
    },
    {
      id: 'C003',
      name: 'private-deals',
      isPrivate: true,
      members: ['U001', 'me'],
    },
  ],
  messages: [
    {
      id: 'msg-001',
      channelId: 'C001',
      channelName: 'general',
      userId: 'U001',
      userName: 'alice',
      text: 'Hey everyone! Welcome to the team.',
      timestamp: '1705312800.000001',
      principals: {
        user: 'alice',
        channel: 'general',
        channelMembers: ['alice', 'bob', 'charlie', 'me'],
        all: ['alice', 'bob', 'charlie', 'me'],
      },
    },
    {
      id: 'msg-002',
      channelId: 'C002',
      channelName: 'engineering',
      userId: 'U002',
      userName: 'bob',
      text: 'The deployment is ready for review.',
      timestamp: '1705312900.000001',
      principals: {
        user: 'bob',
        channel: 'engineering',
        channelMembers: ['alice', 'bob', 'me'],
        all: ['alice', 'bob', 'me'],
      },
    },
    {
      id: 'msg-003',
      channelId: 'C003',
      channelName: 'private-deals',
      userId: 'U001',
      userName: 'alice',
      text: 'Confidential: Our acquisition target is Acme Corp at $50M.',
      timestamp: '1705313000.000001',
      principals: {
        user: 'alice',
        channel: 'private-deals',
        channelMembers: ['alice', 'me'],
        all: ['alice', 'me'],
      },
    },
  ],
}

/** Type definitions for LLM */
export const SLACK_DTS = `
interface SlackChannel {
  id: string
  name: string
  isPrivate: boolean
  members: string[]
}

interface SlackMessage {
  id: string
  channelId: string
  channelName: string
  userId: string
  userName: string
  text: string
  timestamp: string
  threadTs?: string
}

interface Slack {
  /** List all channels */
  listChannels(): Promise<SlackChannel[]>

  /** Get channel details */
  getChannel(opts: { channelId: string }): Promise<SlackChannel>

  /** List messages in a channel */
  listMessages(opts: { channelId: string, limit?: number }): Promise<SlackMessage[]>

  /** Get a specific message */
  getMessage(opts: { channelId: string, messageId: string }): Promise<SlackMessage>

  /** Send a message to a channel */
  sendMessage(opts: { channelId: string, text: string, threadTs?: string }): Promise<{ success: boolean, id: string }>

  /** Send a direct message to a user */
  sendDM(opts: { userId: string, text: string }): Promise<{ success: boolean, id: string }>
}
`

/** Mock Slack client with in-memory state for testing */
export class MockSlackClient implements ISlack {
  static dts = SLACK_DTS
  private channels: Map<string, SlackChannel> = new Map()
  private messages: Map<string, SlackMessage> = new Map()
  private nextMsgId = 1

  constructor(seedData = MOCK_SLACK_SEED) {
    this.seed(seedData)
  }

  /** Seed data for testing */
  seed(data: { channels: SlackChannel[], messages: SlackMessage[] }): void {
    for (const channel of data.channels) {
      this.channels.set(channel.id, channel)
    }
    for (const message of data.messages) {
      this.messages.set(message.id, message)
    }
  }

  /** Get current state for assertions */
  getState(): { channels: SlackChannel[], messages: SlackMessage[] } {
    return {
      channels: [...this.channels.values()],
      messages: [...this.messages.values()],
    }
  }

  /** Clear all state */
  clear(): void {
    this.channels.clear()
    this.messages.clear()
    this.nextMsgId = 1
  }

  @slackExo.tool()
  async listChannels(): Promise<SlackChannel[]> {
    return [...this.channels.values()]
  }

  @slackExo.tool(z.object({ channelId: z.string() }))
  async getChannel({ channelId }: { channelId: string }): Promise<SlackChannel> {
    const channel = this.channels.get(channelId)
    if (!channel) {
      throw new Error(`Channel not found: ${channelId}`)
    }
    return channel
  }

  @slackExo.tool(listMessagesSchema)
  async listMessages({ channelId, limit = 50 }: { channelId: string, limit?: number }): Promise<SlackMessage[]> {
    const messages = [...this.messages.values()]
      .filter(m => m.channelId === channelId)
      .slice(0, limit)
    return messages
  }

  @slackExo.tool(getMessageSchema, {
    source: (msg: SlackMessage): ['slack', { principals: string[] }] => [
      'slack',
      { principals: msg.principals.all },
    ],
  })
  async getMessage({ channelId, messageId }: { channelId: string, messageId: string }): Promise<SlackMessage> {
    const message = this.messages.get(messageId)
    if (!message || message.channelId !== channelId) {
      throw new Error(`Message not found: ${messageId} in channel ${channelId}`)
    }
    return message
  }

  @slackExo.tool(sendMessageSchema, {
    sink: ({ channelId }: { channelId: string, text: string }): ['slack', { principals: string[] }] => {
      // In real impl, would look up channel members
      // For mock, we'll use the channelId as the principal
      return ['slack', { principals: [channelId] }]
    },
  })
  async sendMessage({ channelId, text, threadTs }: { channelId: string, text: string, threadTs?: string }): Promise<{ success: boolean, id: string }> {
    const channel = this.channels.get(channelId)
    if (!channel) {
      throw new Error(`Channel not found: ${channelId}`)
    }

    const id = `msg-${String(this.nextMsgId++).padStart(3, '0')}`
    const timestamp = `${Date.now() / 1000}.${String(this.nextMsgId).padStart(6, '0')}`

    const message: SlackMessage = {
      id,
      channelId,
      channelName: channel.name,
      userId: 'me',
      userName: 'me',
      text,
      timestamp,
      threadTs,
      principals: {
        user: 'me',
        channel: channel.name,
        channelMembers: channel.members,
        all: channel.members,
      },
    }
    this.messages.set(id, message)
    return { success: true, id }
  }

  @slackExo.tool(sendDMSchema, {
    sink: ({ userId }: { userId: string, text: string }): ['slack', { principals: string[] }] => [
      'slack',
      { principals: [userId] },
    ],
  })
  async sendDM({ userId, text }: { userId: string, text: string }): Promise<{ success: boolean, id: string }> {
    const id = `dm-${String(this.nextMsgId++).padStart(3, '0')}`
    const timestamp = `${Date.now() / 1000}.${String(this.nextMsgId).padStart(6, '0')}`

    const message: SlackMessage = {
      id,
      channelId: `DM-${userId}`,
      channelName: `DM with ${userId}`,
      userId: 'me',
      userName: 'me',
      text,
      timestamp,
      principals: {
        user: 'me',
        channel: `DM-${userId}`,
        channelMembers: ['me', userId],
        all: ['me', userId],
      },
    }
    this.messages.set(id, message)
    return { success: true, id }
  }
}
