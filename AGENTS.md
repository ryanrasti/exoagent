## 3/30 Overhaul

exoagentd is the kernel, VMs are processes, caps are syscalls.

1. Gutting -- almost everything goes, we're building on a new model. Keep only:
  a. Minimal flake.nix with nodejs
  b. LICENSE.md
  c. eslint.config.js
  d. tsconfig.json
  e. gitignore

2. New architecture
  a. control plane:
    - workerd (via npm package, not nix)
    - wrangler for dev/build/test, workerd serve for production
    - container management (podman with krun isolation)
  b. global storage
    - workerd durable objects with localDisk storage (sqlite-backed)
  c. capability providers (providers/plugins)
    - these are npm packages in their own right
    - provide .d.ts for types, .js for runtime
    - providers are dynamic workers loaded via WorkerLoader, same as exos
    - providers extend RpcTarget (capnweb), exos get stubs to call them
    - only difference from exos is trust level: providers get more bindings
      (secrets, network access), exos get fewer
    - reloading is uniform: change code in runtime repo, control plane
      re-loads the worker. providers and exos reload the same way.
    - core capabilities
      - createAgent / getAgent / ensureAgent
        - ensureRunning()
        - createAgent specifies definition for an agent, including:
          - name
          - initial capabilities
          - prompt
      - vm
        - create a new vm image rootfs based on a nix derivation
        - will have rw overlay
        - vm is meant to be used with agent -- so agent can do arbitrary stuff
        - krun as the execution primitive -- vm is not persistent, runs command
          then exits. no image persistence, just rootfs/workdir mounts
      - secrets (use mainly by providers -- every provider/exo has
          a secret store scoped to itself)
  d. "exos"/binaries/agent definitions
    - this is static code that run scoped tasks
    - tasks can be one shots or e.g., crons (probably simplest to make cron a provider
      itself that registers a callback)
    - one of the "scoped tasks" can be to spawn an agent
    - agent can have access to a "bash" tool which lets
      it run its own rootfs (defined by nix derivation) krun container
      - container itself has a channel to also run the caps -- via
        an npm package/binary -- e.g., exoeval '(caps) => <code>'
    - exos are dynamic workers loaded via WorkerLoader.get(name, getCode)
    - cap attenuation via env: each exo only gets the bindings it needs
    - globalOutbound: null to block network, or pass a filtering fetcher
    - workerd's V8 isolate IS the sandbox -- replaces exoeval/bwrap
  e. capability rpc transport: capnweb (https://github.com/cloudflare/capnweb)
    - js-native, no schemas, typescript-friendly
    - RpcTarget for pass-by-reference objects (providers)
    - promise pipelining for batching calls
    - works over websocket, http batch, messageport
    - built-in workers interop (newWorkersRpcResponse)

3. Runtime
  a. `exoagentd` -- bash script that generates capnp config and exec's workerd serve
  b. control plane worker has WorkerLoader binding, loads providers and exos as
     dynamic workers
  c. `init` -- looks at all exos, instantiates them (runs code, saves return value --
     which can be a raw result or an `info` cap e.g., to get info about a cron run)
  d. can query exoagentd to figure out:
    - currently running exos
    - paused exos 
    - exited exos
  e. can kill exoagentd

4. Two-repo structure
  a. exoagent (this repo): the kernel
    - control plane worker
    - provider framework
    - exo loader
    - exoagentd script
    - CLI
  b. runtime (user's repo): the state of the world
    - separate git repo, exoagent points to it
    - exo definitions (JS/TS files)
    - provider config (which providers, what secrets they need)
    - agent workdirs as git submodules
      - agent owns its submodule, free reign to commit/branch/push
      - exoagentd commits submodule pointer updates as agents progress
      - runtime repo is the audit trail: git log shows every state change
      - can roll back agent work by resetting submodule pointer
    - git status on runtime repo = what every agent has been doing

5. First use cases: 
  a. Project Manager agent
    - Caps
      - Github: see team/user's activity
      - Slack: talk with team/user
      - Linear: manage project tickets
  b. Engineer agent
    - Caps
      - Github: create PR/poll issues mentioned in/make comment in **that** PR/respond to PR comments
      - VM: work on code locally, test it
    - Eventual goal: build out new projects/manage old projects with agents
