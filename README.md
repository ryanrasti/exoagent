# exoagent

The OS kernel to safely unleash your agents.

**[Try the challenge](https://exoagent.io/challenge)** — Two agents, same LLM, same prompt injection vulnerability. $1,000 in BTC if you can hack the one protected by ExoAgent (coming soon!).

## The Problem

Today's agent frameworks give LLMs raw access to tools. The "security model" is hoping the prompt works.

- **Authorization is broken** — Tool calls inherit user permissions. Your agent gets your credentials — all of them.
- **Interfaces are opaque** — `execute_sql("SELECT * FROM users")` — policy can't see what's inside.
- **No central data policy** — Each tool enforces its own rules. No holistic view. No real guarantees.

## The Fix

Security as a system invariant, not a polite suggestion.

- **Object-capability tools** — Instead of flat tools, pass your agents dynamic objects with strict security guarantees
- **Semantic interfaces** — Rich, secure interaction starting with SQL
- **Central policy** — Declare & enforce what data can flow where

## Installation

```bash
npm install exoagent
```

## Quick Start

Coming soon!

## Roadmap

- [ ] Additional SQL support
- [ ] Policy engine — information flow control to declare & enforce what data can flow where
- [ ] Python port

## Documentation

Coming soon!

## License

[MIT](./LICENSE.md) License © [Ryan Rasti](https://github.com/ryanrasti)
