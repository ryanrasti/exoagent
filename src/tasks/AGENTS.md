# Tasks

A task represents the equivalent of a user-space program.

Tasks are executed on `exoeval` (the custom JS-like interpreter). They specify
their pass capabilities via their structure (destructuring used ones in their
exported default function).

The main idea:
1. Tasks compose existing capabilities to perform new work
2. Tasks are largely authored by LLMs
3. Tasks should be the main unit of work for non-trivial interaction with the
   LLM (e.g., complex or repeated work)
4. Tasks are meant to decouple:
  * control plane: the actual authoring of code that runs
  * data plane: the actual data that flows
5. This decoupling has big advantages:
  * understandability: LLM produces a program once which can be analyzed rather than
     making ad-hoc decisions several times
  * auditability: what runs is code, not loops of LLM calls
  * security: risk of prompt injection massively falls by not putting a full-powered
     LLM in the hot path

The first tasks to build for our demo:
1. Gmail summarizer: every night at 5pm, write an email to yourself summarizing the
   important emails from that day and calendar events coming up.
2. Meeting scheduler: when a request for a meeting comes in, or user asks you, schedule
   a meeting with the appropriate party, which includes and email and calendar invite.

Here's what will be needed:
1. `subagent` plugin: should be a simple wrapper around ai sdk + `src/code-mode.ts`.
   The idea is that subagent creates a task -- but does so dynamically -- and executes it.
   * `subagent` is **not** the preferred way to implement new tasks *except* for cases where
     it drastically simplifies the setup/makes the task more robust without meaningfully
     increasing the risk of prompt-injection
1. setup-gmail: instead of the current approach, just make a few subagent invocations with a browser
   bound to `console.cloud.google.com`. That should be robust to ux quirks and changes

Environments:
1. We want the idea of different environments (capability implementations) to be configurable
   and swapable.
2. Changes needed:
  - each plugin should define an interface with a default implementation
  - each plugin should also provide a fake implementation with fake data
  - we should also have burner credentials (e.g., burner google account) to test e2e with fake
    data -- this really means we have a default `capability.ts` and and secondary `capability.ts`
    or something. plugins just need to support not being hard-coded to a single underlying credential

End result:
1. `setup-gmail` should work e2e on burner credentials and be a few simple subagent calls or equivalent.
  - it should be tested multiple times, on exisitng and new cloud projects
2. Gmail summarizer -- should be tested with both fake and burner data. Should have unit tests.
3. Meeting scheduler -- should also be tested with fake and burner data. Should have unit tests.
