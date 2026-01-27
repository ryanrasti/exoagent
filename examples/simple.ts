#!/usr/bin/env -S npx tsx
/**
 * Simple Example: Users and Todos Chatbot
 *
 * This example demonstrates ExoAgent's capability-based security with a simple
 * user/todo application. The agent can only access todos for the user it's given
 * a capability to.
 *
 * Run: ./examples/simple.ts
 * Or:  npx tsx examples/simple.ts
 */
import type { LanguageModel } from 'ai'
import process from 'node:process'
import { generateText, stepCountIs } from 'ai'
import BetterSqlite3 from 'better-sqlite3'
import { CodeMode, createDenoSandbox, tool } from 'exoagent'
import { Database } from 'exoagent/sql'
import { SqliteDialect } from 'kysely'
import { getModel, runRepl } from './utils'

// ============================================================================
// Database Setup (in-memory SQLite)
// ============================================================================

const sqlite = new BetterSqlite3(':memory:')

// Migrations
sqlite.exec(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE
  );

  CREATE TABLE todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`)

// Seed data
sqlite.exec(`
  INSERT INTO users (id, name, email) VALUES
    (1, 'Alice', 'alice@example.com'),
    (2, 'Bob', 'bob@example.com');

  INSERT INTO todos (user_id, title, completed) VALUES
    (1, 'Buy groceries', 0),
    (1, 'Walk the dog', 1),
    (1, 'Finish report', 0),
    (2, 'Call mom', 0),
    (2, 'Book dentist appointment', 0);
`)

// ============================================================================
// ExoAgent Data Model
// ============================================================================

const db = new Database(new SqliteDialect({ database: sqlite }), { returnExecutedQuery: true })

class Todo extends db.Table('todos').as('todo') {
  id = this.column('id')
  userId = this.column('user_id')
  title = this.column('title')
  completed = this.column('completed')
  createdAt = this.column('created_at')
}

class User extends db.Table('users').as('user') {
  id = this.column('id')
  name = this.column('name')
  email = this.column('email')

  @tool()
  todos() {
    return Todo.on(todo => todo.userId['='](this.id)).from()
  }
}

// ============================================================================
// Chatbot
// ============================================================================

async function chat(userPrompt: string, model: LanguageModel, userId: number = 1) {
  // Create a capability scoped to the specified user
  const userCap = User.on(u => u.id['='](userId)).from()

  // Wrap with CodeMode for sandboxed execution
  const codeMode = new CodeMode(createDenoSandbox())
  const codeTool = await codeMode.wrap({
    currentUser: () => userCap,
  }, `class Todo extends db.Table('todos').as('todo') {
  id = this.column('id')
  userId = this.column('user_id')
  title = this.column('title')
  completed = this.column('completed')
  createdAt = this.column('created_at')
}

class User extends db.Table('users').as('user') {
  id = this.column('id')
  name = this.column('name')
  email = this.column('email')

  @tool()
  todos() {
    return Todo.on(todo => todo.userId['='](this.id)).from()
  }
}`)

  const result = await generateText({
    model,
    tools: { execute: codeTool },
    stopWhen: stepCountIs(10),
    system: `You are a helpful assistant that helps users manage their todos.
You have access to the current user's information and their todos.
Use the execute tool to query the database. The API provides:
- currentUser(): Returns a query builder for the current user's data
- user.todos(): Returns a query builder for the user's todos.

Example:
- (api) => api.currentUser().join(({ user }) => user.todos()).select(({ todo }) => ({title: todo.title, completed: todo.completed})).execute()
- (api) => api.currentUser().join(({ user }) => user.todos()).where(({ todo }) => todo.completed['='](0)).select(({ todo }) => ({title: todo.title, completed: todo.completed})).execute()

To do a SELECT *, use this shorthand: (api) => api.currentUser().join(({ user }) => user.todos()).select(({ user }) => user)
Select must return a row object (not a flat column).

Always use .execute() at the end of your query chains to get results.`,
    prompt: userPrompt,
  })

  return result
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const { model, name } = await getModel()

  await runRepl({
    title: `ExoAgent Simple Example: Users & Todos [${name}]`,
    context: 'You are logged in as Alice (user_id=1)',
    chat: async prompt => await chat(prompt, model),
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error)
}

export { chat, Todo, User }
