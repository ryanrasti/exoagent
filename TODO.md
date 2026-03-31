# TODO

## Next up

### 1. Shim loader
Core primitive — loads a provider/exo as a dynamic worker with cap attenuation.

- Generic shim.js that all providers/exos use as mainModule
- Static imports manifest.js, runs it with pre-scoped root caps
- Dynamic imports worker.js after attenuation, passes only attenuated caps
- Root caps are function-scoped in shim, GC'd before worker.js runs
- Control plane API: `loadProvider(name, manifestCode, workerCode, rootCaps)`
- globalOutbound: null on every dynamic worker
- Test: load a dynamic worker, verify it can only access attenuated caps

### 2. Config generation
`exoagentd` generates wrangler.jsonc dynamically from provider manifests.

- Scan provider packages for manifest declarations
- Generate DO bindings + migrations for providers that request storage
- Use provider name as uniqueKey (stable across restarts)
- localDisk storage pointing at a fixed data directory
- Exec workerd serve with the generated config
- Data persists across provider add/remove/re-add

### 3. GitHub provider
First real provider — proves the full pattern end-to-end.

- Own DO with SQLite (stores token, repos to watch, etc.)
- UI panel at /github/ for config (paste token, select repos)
- capnweb RPC at /github/api
- Uses scoped fetch cap for api.github.com
- Manifest: `{ fetch: (f) => f.scoped('api.github.com') }`
- Methods: createPR, getReviews, listRepos, etc.
- status() method for dashboard polling

### 4. Dashboard
Root React app at / served by control plane.

- Lists all registered providers/exos with status
- Polls each provider's status() RPC method
- Links to provider UI panels (/<name>/)
- Surfaces issues: needs config, crashed, pending actions
- Search across providers/exos

### 5. Runtime repo structure
The user's separate git repo — state of the world.

- Exo definitions (JS/TS files with manifests)
- Provider references (which packages, which versions)
- Agent workdirs as git submodules
- exoagentd reads this repo, generates config, loads everything
- Git log = audit trail of all agent activity

### 6. VM provider (krun)
For agents that need a full OS environment.

- krun as execution primitive (podman + libkrun)
- Rootfs from nix derivation, rw overlay
- Ephemeral: run command, exit, no image persistence
- Agent's bash tool runs commands inside krun container
- Container has channel back to caps via capnweb
- Add crun/krun to nix flake
