import { getDb } from './index'
import type { Taint } from '../../../eval/utils'

export interface ThreadRow {
  id: string
  title: string | null
  pinned: number
  status: string
  created_at: number | null
  updated_at: number | null
}

export interface MessageRow {
  id: string
  thread_id: string | null
  role: 'user' | 'assistant'
  content: string
  data: unknown
  taints: Taint[]
  code: string | null
  created_at: number | null
}

/** Create a new thread */
export async function createThread(id: string, title?: string): Promise<ThreadRow> {
  const db = await getDb()
  const now = Date.now()

  await db.insertInto('threads').values({
    id,
    title: title ?? null,
    status: 'active',
    created_at: now,
    updated_at: now,
  }).execute()

  return { id, title: title ?? null, pinned: 0, status: 'active', created_at: now, updated_at: now }
}

/** Get a thread by ID */
export async function getThread(id: string): Promise<ThreadRow | null> {
  const db = await getDb()
  const row = await db.selectFrom('threads').selectAll().where('id', '=', id).executeTakeFirst()
  return row ?? null
}

/** Get all threads ordered by pinned first, then most recent */
export async function listThreads(): Promise<ThreadRow[]> {
  const db = await getDb()
  return db.selectFrom('threads')
    .selectAll()
    .orderBy('pinned', 'desc')
    .orderBy('updated_at', 'desc')
    .execute()
}

/** Pin a thread */
export async function pinThread(id: string): Promise<void> {
  const db = await getDb()
  await db.updateTable('threads')
    .set({ pinned: 1 })
    .where('id', '=', id)
    .execute()
}

/** Unpin a thread */
export async function unpinThread(id: string): Promise<void> {
  const db = await getDb()
  await db.updateTable('threads')
    .set({ pinned: 0 })
    .where('id', '=', id)
    .execute()
}

/** Update thread title */
export async function updateThreadTitle(id: string, title: string): Promise<void> {
  const db = await getDb()
  await db.updateTable('threads')
    .set({ title, updated_at: Date.now() })
    .where('id', '=', id)
    .execute()
}

/** Delete a thread and its messages */
export async function deleteThread(id: string): Promise<void> {
  const db = await getDb()
  await db.deleteFrom('messages').where('thread_id', '=', id).execute()
  await db.deleteFrom('threads').where('id', '=', id).execute()
}

/** Update thread's updated_at timestamp */
export async function touchThread(id: string): Promise<void> {
  const db = await getDb()
  await db.updateTable('threads')
    .set({ updated_at: Date.now() })
    .where('id', '=', id)
    .execute()
}

/** Add a message to a thread */
export async function addMessage(
  threadId: string,
  message: {
    id: string
    role: 'user' | 'assistant'
    content: string
    data?: unknown
    taints?: Taint[]
    code?: string
  },
): Promise<void> {
  const db = await getDb()

  await db.insertInto('messages').values({
    id: message.id,
    thread_id: threadId,
    role: message.role,
    content: message.content,
    data: message.data !== undefined ? JSON.stringify(message.data) : null,
    taints: JSON.stringify(message.taints ?? []),
    code: message.code ?? null,
    created_at: Date.now(),
  }).execute()

  // Update thread's updated_at
  await touchThread(threadId)
}

/** Get all messages for a thread */
export async function getMessages(threadId: string): Promise<MessageRow[]> {
  const db = await getDb()
  const rows = await db.selectFrom('messages')
    .selectAll()
    .where('thread_id', '=', threadId)
    .orderBy('created_at', 'asc')
    .execute()

  return rows.map(row => ({
    id: row.id,
    thread_id: row.thread_id,
    role: row.role as 'user' | 'assistant',
    content: row.content,
    data: row.data ? JSON.parse(row.data) : null,
    taints: JSON.parse(row.taints),
    code: row.code,
    created_at: row.created_at,
  }))
}

/** Convert messages to Turn[] format for LLM */
export function messagesToTurns(messages: MessageRow[]): Array<
  | { role: 'user', content: string }
  | { role: 'assistant', response: string, data: unknown, taints: Taint[] }
> {
  return messages.map((msg) => {
    if (msg.role === 'user') {
      return { role: 'user' as const, content: msg.content }
    }
    return {
      role: 'assistant' as const,
      response: msg.content,
      data: msg.data,
      taints: msg.taints,
    }
  })
}
