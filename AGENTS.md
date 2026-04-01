## Future Features / Use Cases

1. Implement Submodule Git Tracking
   - The runtime repo is the state of the world.
   - Agent workdirs as git submodules.
   - `exoagentd` commits submodule pointer updates as agents progress.
   - Git status on runtime repo = what every agent has been doing.

2. Capability Providers to implement:
   - `bash`: allow execution of host-level or local tools.
   - `vm`: create a new vm image rootfs based on a nix derivation via Krun.
   - `slack`: talk with team/user.
   - `linear`: manage project tickets.

3. "Exos" / Agent definitions:
   - Provide a way to run static code for scoped tasks (e.g. crons).
   - Engineer Agent: GitHub cap (create/poll/respond to PRs) + VM cap (local testing).
   - Project Manager Agent: GitHub (team activity), Slack (chat), Linear (tickets).
