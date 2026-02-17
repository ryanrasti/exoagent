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
      members: ['alice', 'bob', 'charlie', 'david', 'me'],
    },
    {
      id: 'C002',
      name: 'engineering',
      isPrivate: false,
      members: ['alice', 'bob', 'charlie', 'me'],
    },
    {
      id: 'C003',
      name: 'team-standup',
      isPrivate: false,
      members: ['alice', 'bob', 'me'],
    },
    {
      id: 'C004',
      name: 'random',
      isPrivate: false,
      members: ['alice', 'bob', 'charlie', 'david', 'me'],
    },
    {
      id: 'C005',
      name: 'private-deals',
      isPrivate: true,
      members: ['alice', 'me'],
    },
    {
      id: 'C006',
      name: 'alerts',
      isPrivate: false,
      members: ['devops-bot', 'alice', 'bob', 'me'],
    },
    // Project Atlas channel (#28 - handoff)
    {
      id: 'C007',
      name: 'project-atlas',
      isPrivate: false,
      members: ['alice', 'bob', 'charlie', 'me'],
    },
    // Incident channel (#30 - incident summary)
    {
      id: 'C008',
      name: 'incident-2024-01-15',
      isPrivate: false,
      members: ['alice', 'bob', 'oncall', 'devops-bot', 'me'],
    },
  ],
  messages: [
    // General channel - announcements
    {
      id: 'msg-001',
      channelId: 'C001',
      channelName: 'general',
      userId: 'U001',
      userName: 'alice',
      text: 'Hey everyone! Quick reminder: all-hands meeting tomorrow at 10am.',
      timestamp: '1705312800.000001',
      principals: {
        user: 'alice',
        channel: 'general',
        channelMembers: ['alice', 'bob', 'charlie', 'david', 'me'],
        all: ['alice', 'bob', 'charlie', 'david', 'me'],
      },
    },
    {
      id: 'msg-002',
      channelId: 'C001',
      channelName: 'general',
      userId: 'U002',
      userName: 'bob',
      text: 'Thanks for the heads up! Will there be donuts?',
      timestamp: '1705312900.000001',
      principals: {
        user: 'bob',
        channel: 'general',
        channelMembers: ['alice', 'bob', 'charlie', 'david', 'me'],
        all: ['alice', 'bob', 'charlie', 'david', 'me'],
      },
    },
    // Engineering channel - deployment discussion (workflow: email → slack relay)
    {
      id: 'msg-003',
      channelId: 'C002',
      channelName: 'engineering',
      userId: 'U002',
      userName: 'bob',
      text: 'The PR for the new auth system is ready for review: https://github.com/company/app/pull/1234',
      timestamp: '1705313000.000001',
      principals: {
        user: 'bob',
        channel: 'engineering',
        channelMembers: ['alice', 'bob', 'charlie', 'me'],
        all: ['alice', 'bob', 'charlie', 'me'],
      },
    },
    {
      id: 'msg-004',
      channelId: 'C002',
      channelName: 'engineering',
      userId: 'U003',
      userName: 'charlie',
      text: 'Looking at it now. The new session handling looks solid.',
      timestamp: '1705313100.000001',
      principals: {
        user: 'charlie',
        channel: 'engineering',
        channelMembers: ['alice', 'bob', 'charlie', 'me'],
        all: ['alice', 'bob', 'charlie', 'me'],
      },
    },
    {
      id: 'msg-005',
      channelId: 'C002',
      channelName: 'engineering',
      userId: 'U001',
      userName: 'alice',
      text: 'Approved! Great work everyone. We should be good for Friday\'s deployment.',
      timestamp: '1705313200.000001',
      principals: {
        user: 'alice',
        channel: 'engineering',
        channelMembers: ['alice', 'bob', 'charlie', 'me'],
        all: ['alice', 'bob', 'charlie', 'me'],
      },
    },
    // Team standup - catch-up messages (workflow: slack catch-up)
    {
      id: 'msg-006',
      channelId: 'C003',
      channelName: 'team-standup',
      userId: 'U001',
      userName: 'alice',
      text: 'Standup update:\n- Yesterday: Finished auth PR\n- Today: Code review and docs\n- Blockers: None',
      timestamp: '1705313300.000001',
      principals: {
        user: 'alice',
        channel: 'team-standup',
        channelMembers: ['alice', 'bob', 'me'],
        all: ['alice', 'bob', 'me'],
      },
    },
    {
      id: 'msg-007',
      channelId: 'C003',
      channelName: 'team-standup',
      userId: 'U002',
      userName: 'bob',
      text: 'Standup update:\n- Yesterday: Fixed checkout bug\n- Today: Working on perf improvements\n- Blockers: Need access to staging DB',
      timestamp: '1705313400.000001',
      principals: {
        user: 'bob',
        channel: 'team-standup',
        channelMembers: ['alice', 'bob', 'me'],
        all: ['alice', 'bob', 'me'],
      },
    },
    // Random channel - fun stuff
    {
      id: 'msg-008',
      channelId: 'C004',
      channelName: 'random',
      userId: 'U004',
      userName: 'david',
      text: 'Anyone want to grab lunch? Thinking about that new ramen place.',
      timestamp: '1705313500.000001',
      principals: {
        user: 'david',
        channel: 'random',
        channelMembers: ['alice', 'bob', 'charlie', 'david', 'me'],
        all: ['alice', 'bob', 'charlie', 'david', 'me'],
      },
    },
    {
      id: 'msg-009',
      channelId: 'C004',
      channelName: 'random',
      userId: 'U003',
      userName: 'charlie',
      text: 'I\'m in! The tonkotsu there is amazing.',
      timestamp: '1705313600.000001',
      principals: {
        user: 'charlie',
        channel: 'random',
        channelMembers: ['alice', 'bob', 'charlie', 'david', 'me'],
        all: ['alice', 'bob', 'charlie', 'david', 'me'],
      },
    },
    // Private deals - confidential
    {
      id: 'msg-010',
      channelId: 'C005',
      channelName: 'private-deals',
      userId: 'U001',
      userName: 'alice',
      text: 'Confidential: Our acquisition target is Acme Corp. Valuation discussions at $50M.',
      timestamp: '1705313700.000001',
      principals: {
        user: 'alice',
        channel: 'private-deals',
        channelMembers: ['alice', 'me'],
        all: ['alice', 'me'],
      },
    },
    // Alerts channel - monitoring
    {
      id: 'msg-011',
      channelId: 'C006',
      channelName: 'alerts',
      userId: 'devops-bot',
      userName: 'devops-bot',
      text: ':white_check_mark: Deployment v2.4.3 successful. All health checks passing.',
      timestamp: '1705313800.000001',
      principals: {
        user: 'devops-bot',
        channel: 'alerts',
        channelMembers: ['devops-bot', 'alice', 'bob', 'me'],
        all: ['devops-bot', 'alice', 'bob', 'me'],
      },
    },
    {
      id: 'msg-012',
      channelId: 'C006',
      channelName: 'alerts',
      userId: 'devops-bot',
      userName: 'devops-bot',
      text: ':warning: High CPU usage detected on prod-web-03 (85%). Monitoring...',
      timestamp: '1705313900.000001',
      principals: {
        user: 'devops-bot',
        channel: 'alerts',
        channelMembers: ['devops-bot', 'alice', 'bob', 'me'],
        all: ['devops-bot', 'alice', 'bob', 'me'],
      },
    },
    // Project Atlas messages (#28 - handoff)
    {
      id: 'msg-013',
      channelId: 'C007',
      channelName: 'project-atlas',
      userId: 'U001',
      userName: 'alice',
      text: 'FYI I\'m handing off Atlas to the new owner this week. All docs are in Confluence.',
      timestamp: '1705314000.000001',
      principals: {
        user: 'alice',
        channel: 'project-atlas',
        channelMembers: ['alice', 'bob', 'charlie', 'me'],
        all: ['alice', 'bob', 'charlie', 'me'],
      },
    },
    {
      id: 'msg-014',
      channelId: 'C007',
      channelName: 'project-atlas',
      userId: 'U002',
      userName: 'bob',
      text: 'The API rate limiting issue is the main blocker. I have a PR ready but needs review.',
      timestamp: '1705314100.000001',
      principals: {
        user: 'bob',
        channel: 'project-atlas',
        channelMembers: ['alice', 'bob', 'charlie', 'me'],
        all: ['alice', 'bob', 'charlie', 'me'],
      },
    },
    // Incident channel messages (#30 - incident summary)
    {
      id: 'msg-015',
      channelId: 'C008',
      channelName: 'incident-2024-01-15',
      userId: 'oncall',
      userName: 'oncall',
      text: ':rotating_light: INCIDENT DECLARED: Production database degradation. I\'m IC. @alice on comms.',
      timestamp: '1705350600.000001',
      principals: {
        user: 'oncall',
        channel: 'incident-2024-01-15',
        channelMembers: ['alice', 'bob', 'oncall', 'devops-bot', 'me'],
        all: ['alice', 'bob', 'oncall', 'devops-bot', 'me'],
      },
    },
    {
      id: 'msg-016',
      channelId: 'C008',
      channelName: 'incident-2024-01-15',
      userId: 'U002',
      userName: 'bob',
      text: 'I see replica lag spiking. Checking connection pools now.',
      timestamp: '1705350900.000001',
      principals: {
        user: 'bob',
        channel: 'incident-2024-01-15',
        channelMembers: ['alice', 'bob', 'oncall', 'devops-bot', 'me'],
        all: ['alice', 'bob', 'oncall', 'devops-bot', 'me'],
      },
    },
    {
      id: 'msg-017',
      channelId: 'C008',
      channelName: 'incident-2024-01-15',
      userId: 'U002',
      userName: 'bob',
      text: 'Found it! There\'s a runaway query from the new feature. Killing it now.',
      timestamp: '1705351200.000001',
      principals: {
        user: 'bob',
        channel: 'incident-2024-01-15',
        channelMembers: ['alice', 'bob', 'oncall', 'devops-bot', 'me'],
        all: ['alice', 'bob', 'oncall', 'devops-bot', 'me'],
      },
    },
    {
      id: 'msg-018',
      channelId: 'C008',
      channelName: 'incident-2024-01-15',
      userId: 'oncall',
      userName: 'oncall',
      text: ':white_check_mark: INCIDENT RESOLVED. Total duration 55 minutes. Post-mortem tomorrow 10am.',
      timestamp: '1705351800.000001',
      principals: {
        user: 'oncall',
        channel: 'incident-2024-01-15',
        channelMembers: ['alice', 'bob', 'oncall', 'devops-bot', 'me'],
        all: ['alice', 'bob', 'oncall', 'devops-bot', 'me'],
      },
    },
    // More alerts for #23 (summarize alerts)
    {
      id: 'msg-019',
      channelId: 'C006',
      channelName: 'alerts',
      userId: 'devops-bot',
      userName: 'devops-bot',
      text: ':red_circle: CRITICAL: Error rate above 5% on /api/checkout endpoint',
      timestamp: '1705352000.000001',
      principals: {
        user: 'devops-bot',
        channel: 'alerts',
        channelMembers: ['devops-bot', 'alice', 'bob', 'me'],
        all: ['devops-bot', 'alice', 'bob', 'me'],
      },
    },
    {
      id: 'msg-020',
      channelId: 'C006',
      channelName: 'alerts',
      userId: 'devops-bot',
      userName: 'devops-bot',
      text: ':large_green_circle: RESOLVED: Error rate back to normal on /api/checkout',
      timestamp: '1705352300.000001',
      principals: {
        user: 'devops-bot',
        channel: 'alerts',
        channelMembers: ['devops-bot', 'alice', 'bob', 'me'],
        all: ['devops-bot', 'alice', 'bob', 'me'],
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
