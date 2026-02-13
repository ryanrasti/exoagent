import type { ColumnType } from 'kysely'

export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>

export interface Config {
  key: string
  value: string
  created_at: Generated<number | null>
  updated_at: Generated<number | null>
}

export interface Threads {
  id: string
  parent_id: string | null
  title: string | null
  pinned: Generated<number>
  status: Generated<string>
  taints: Generated<string>
  created_at: Generated<number | null>
  updated_at: Generated<number | null>
}

export interface Messages {
  id: string
  thread_id: string
  role: string
  content: string
  data: string | null
  taints: Generated<string>
  code: string | null
  created_at: Generated<number | null>
}

export interface Secrets {
  key: string
  value: string
  created_at: Generated<number | null>
  updated_at: Generated<number | null>
}

export interface DB {
  config: Config
  threads: Threads
  messages: Messages
  secrets: Secrets
}
