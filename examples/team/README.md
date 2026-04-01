# team — example runtime

This is an example "runtime" directory that demonstrates how exoagent
dynamically loads and wires providers.

## Providers loaded

The daemon scans `src/providers/` and instantiates them via DAG resolution:

```
sqlite  (ring0: better-sqlite3)
fetch   (ring0: globalThis.fetch)
  └── config  (depends on: sqlite)
        └── github  (depends on: config, fetch)
```

## Running

```bash
# From the repo root:
pnpm dev
# Dashboard: http://localhost:3000/
# GitHub UI: http://github.localhost:3000/
```

## How it works

1. Each provider has a `manifest.ts` declaring dependencies + attenuation
2. The loader strips TS, splits ring0 from attenuation via acorn
3. ring0 functions run in real JS (outside SES) to load native bindings
4. Attenuation functions run in exoeval with auto-scoped caps
5. Providers receive a `BoundEval<Caps>` — all inter-provider calls go through exoeval
