# ExoAgent

The OS kernel to safely unleash your agents.

![ExoAgent Demo](./website/public/demo.gif)

🛡️ **[Live Challenge: Steal my $1,000 BTC](https://exoagent.io/challenge)**
We put a real Bitcoin wallet in a database protected by ExoAgent. If you can prompt-inject the agent to extract the private key, you keep the money.

## The Problem

Today's agent frameworks give LLMs raw access to tools. The "security model" is hoping the system prompt works.

- 🚨 **Authorization is broken:** Tool calls inherit *your* full permissions. You asked for dinner delivery; your driver got your wallet.
- 🌫️ **Interfaces are opaque:** `execute_sql("SELECT * FROM users")` is a black box. Policy engines can't enforce constraints on raw strings.
- 🕸️ **No central policy:** Each tool enforces its own rules. There is no way to guarantee that data doesn't leak across them.

## The Fix: Deterministic security, not Prompts

ExoAgent uses **Object Capabilities (OCap)** to enforce security at the runtime layer. Instead of giving the agent a "Database Tool," you give it a constrained **Capability Object** that can only access specific rows.

It doesn't matter if the LLM gets jailbroken. It runs inside a sandbox where invalid actions are mathematically impossible. Security as a system invariant, not a polite suggestion.

![ExoAgent Architecture](./website/public/architecture.jpg)

## Quick Start

### 1. Installation

```bash
npm install exoagent ai

# These two depend on your config
npm install @ai-sdk/google # ...or the model provider you plan to use
npm install better-sqlite3 # ...or the database you plan to use (Kysely compatible only)
```

### 2. Define your Safe Interface

Wrap your database in a semantic layer. This defines the **boundaries** the agent cannot cross.

```typescript
import BetterSqlite3 from 'better-sqlite3'
import { tool } from 'exoagent'
import { Database } from 'exoagent/sql'
import { SqliteDialect } from 'kysely'

const sqlite = new BetterSqlite3(':memory:')
const db = new Database(new SqliteDialect({ database: sqlite }))

class Todo extends db.Table('todos').as('todo') {
  id = this.column('id')
  userId = this.column('user_id')
  title = this.column('title')
  completed = this.column('completed')
}

class User extends db.Table('users').as('user') {
  id = this.column('id')
  name = this.column('name')
  email = this.column('email')

  @tool()
  todos() {
    // Defines relations -- don't forget the `from()`:
    return Todo.on(todo => todo.userId['='](this.id)).from()
  }
}
```

### 3. Unleash the agent

```typescript
import { google } from '@ai-sdk/google'
import { generateText, stepCountIs } from 'ai'
import { CodeMode, createDenoSandbox } from 'exoagent'

// Create a capability scoped to user_id=1
const userCap = User.on(u => u.id['='](1)).from()

// Wrap with CodeMode for sandboxed execution
const codeMode = new CodeMode(createDenoSandbox())
const codeTool = await codeMode.wrap({
  currentUser: () => userCap,
}, schemaString) // schemaString = the class definitions above as a string

const result = await generateText({
  model: google('gemini-2.5-flash'),
  tools: { execute: codeTool },
  stopWhen: stepCountIs(10),
  system: '...', // See examples/simple.ts for full system prompt
  prompt: 'Show me my incomplete todos',
})
```

**What just happened?** The Agent cannot run `SELECT * FROM users`. It lacks the
reference to the global `User` table. It can only operate on `userCap` which
forces the SQL to be scoped to the specific user.

### 4. Try it out

Run the working examples:

```bash
cd examples/
npm i
npm i exoagent@latest

# Simple example (users & todos)
npx tsx simple.ts

# Complex SaaS example (org -> project -> task -> comment)
npx tsx saas-bot.ts
```

Note the examples require:
1. NodeJS (runtime)
2. [Deno](https://docs.deno.com/runtime/getting_started/installation/) (sandbox)
3. An LLM API key set via one of the env vars:
   - `OPENAI_API_KEY`
   - `ANTHROPIC_API_KEY`
   - `GOOGLE_GENERATIVE_AI_API_KEY`

## Architecture
ExoAgent sits between your LLM and your infrastructure as a regular tool.
1. **Protocol**: Uses [Cap'n Web](https://github.com/cloudflare/capnweb) (RPC) as the transport.
2. **Runtime**: Runs in a JS code sandbox (user-configured; Deno supported out of the box, more to come).
3. **Query Builder**: Uses a custom capability SQL builder that compiles to safe SQL.

## ⚠️ Project Status: Experimental (v0.0.x)
ExoAgent is an exploration of capability-based security for LLMs. While the architecture (OCaps + Sandboxing) is theoretically robust, this specific implementation is new and may contain bugs.

**The Guarantee**: We are confident enough in the core design that we are putting real money on the line. If you find a bypass, you get paid.

## Roadmap

- [ ] Additional sandbox robustness
- [ ] Additional SQL support: aggregations, mutations, advanced SQL
- [ ] Policy engine: Declarative information flow controls (e.g., "PII cannot flow to Slack")
- [ ] Python SDK integration: For integration with the Python ecosystem.

### FAQs
**Q: Why not just use RLS (row-level security)?**

A: Two main reasons:
1. **Defense in Depth:** RLS has existed for a decade, yet no security team allows raw, untrusted SQL to run against production databases. You still need protection against resource exhaustion, unsafe functions, and column-level leaks.
2. **Logic beyond the DB:** RLS is locked to the database. ExoAgent is a **general-purpose policy layer**. We want to enforce rules that span systems, like: *"The `email` column is PII. PII cannot be sent to the Slack tool."*

**Q: Why not just use "LLM Guardrails" or System Prompts?**

A: Those are **Probabilistic**. Guardrails reduce the *likelihood* of a breach, but they don't eliminate it. In security, a 99% success rate is a failing grade. ExoAgent provides **Deterministic** security—if the agent doesn't have the capability, the action is mathematically impossible.

## License

[MIT](./LICENSE.md) License © [Ryan Rasti](https://github.com/ryanrasti)
