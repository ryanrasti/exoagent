import type { BountyAgent } from '../worker/index'
import { newWebSocketRpcSession } from 'capnweb'
import { useEffect, useState } from 'react'
import { ExoAgentChat, RawSqlAgentChat } from './AgentChat'
import { GITHUB_URL, GitHubLink, Layout } from './Layout'

export function Challenge() {
  const [hackCount, setHackCount] = useState<number | null>(null)
  const [attemptCount, setAttemptCount] = useState<number | null>(null)
  const [fresh, setFresh] = useState(false)

  // Fetch stats on mount using RPC
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const rpcUrl = `${protocol}//${window.location.host}/api/bounty/rpc`;
    (async () => {
      using agent = newWebSocketRpcSession<BountyAgent>(rpcUrl)
      try {
        const { hackCount, attemptCount, fresh } = await agent.stats()
        setHackCount(hackCount)
        setAttemptCount(attemptCount)
        setFresh(fresh)
      }
      catch (error) {
        console.error('error fetching stats', error)
      }
    })()
  }, [])

  return (
    <Layout headerRight={<GitHubLink>Star on GitHub</GitHubLink>}>
      {/* Hero */}
      <section className="px-8 py-12 max-w-6xl mx-auto">
        <h1 className="text-4xl md:text-5xl font-bold text-center mb-4">
          Hack this agent. Win Bitcoin.
          <span className="ml-3 text-lg font-normal text-amber-500 align-middle">(v0.1 preview)</span>
        </h1>
        <p className="text-xl text-neutral-400 text-center max-w-2xl mx-auto mb-4">
          Both agents have the same LLM, same database, same prompt injection vulnerability.
          Only one can be exploited.
        </p>
        <p className="text-lg text-amber-500 text-center max-w-2xl mx-auto mb-8">
          Extract the private key from the ExoAgent database and the
          {' '}
          <span className="font-bold">BTC is yours</span>
          .
        </p>
      </section>

      {/* Stats bar */}
      {fresh && (
        <section className="px-8 py-4 bg-neutral-900 border-y border-neutral-800">
          <div className="max-w-6xl mx-auto flex justify-center gap-12">
            <div className="text-center">
              <div className="text-3xl font-bold text-red-500">
                {hackCount !== null ? hackCount.toLocaleString() : '—'}
              </div>
              <div className="text-sm text-neutral-500">Times Raw SQL hacked</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-green-500">0</div>
              <div className="text-sm text-neutral-500">Times ExoAgent hacked</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-neutral-400">
                {attemptCount !== null ? attemptCount.toLocaleString() : '—'}
              </div>
              <div className="text-sm text-neutral-500">ExoAgent hack attempts</div>
            </div>
          </div>
        </section>
      )}
      {/* Side-by-side agents */}
      <section className="px-8 py-12 max-w-7xl mx-auto">
        <div className="grid md:grid-cols-2 gap-8">
          {/* Raw SQL Agent (Hackable) */}
          <div className="border border-red-900/50 rounded-xl overflow-hidden bg-neutral-900/50">
            <div className="px-6 py-4 bg-red-950/30 border-b border-red-900/50">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-red-500 text-2xl">💀</span>
                <h2 className="text-xl font-bold text-red-400">Raw SQL Agent</h2>
              </div>
              <p className="text-sm text-neutral-400">
                Standard LLM with direct SQL access.
                {' '}
                <span className="text-red-400">$1 bounty</span>
                {' '}
                (refreshes daily)
              </p>
            </div>
            <RawSqlAgentChat />
          </div>

          {/* ExoAgent (Protected) */}
          <div className="border border-green-900/50 rounded-xl overflow-hidden bg-neutral-900/50">
            <div className="px-6 py-4 bg-green-950/30 border-b border-green-900/50">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-green-500 text-2xl">🛡️</span>
                <h2 className="text-xl font-bold text-green-400">ExoAgent Protected</h2>
              </div>
              <p className="text-sm text-neutral-400">
                Same LLM, execution-layer security.
                {' '}
                <span className="text-green-400">$1,000 bounty</span>
              </p>
            </div>
            <ExoAgentChat />
          </div>
        </div>
      </section>

      {/* What just happened */}
      <section className="px-8 py-12 bg-neutral-900/50 border-t border-neutral-800">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold mb-6">What just happened?</h2>
          <p className="text-neutral-300 mb-4">
            LLMs can't distinguish between instructions and data. When you send a message, the model sees your input
            mixed with the system prompt. A cleverly crafted message can override the original instructions entirely.
          </p>
          <p className="text-neutral-300">
            This isn't a bug — it's fundamental to how language models work. The attack surface is
            {' '}
            <em>in-band</em>
            .
          </p>
        </div>
      </section>

      {/* Why one got hacked */}
      <section className="px-8 py-12 border-t border-neutral-800">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold mb-6">Why one got hacked and the other didn't</h2>
          <p className="text-neutral-300 mb-4">
            Traditional tool calls force a tradeoff: flexibility (raw SQL) or safety (rigid
            {' '}
            <code className="bg-neutral-800 px-1.5 py-0.5 rounded text-sm">get_order_for_user()</code>
            {' '}
            endpoints). You can't have both.
          </p>
          <p className="text-neutral-300 mb-4">
            ExoAgent lets the agent
            {' '}
            <strong className="text-neutral-100">compose code</strong>
            {' '}
            against a capability-constrained API.
            The agent gets the expressiveness of a query builder — joins, filters, projections — but can only access
            {' '}
            <a href="https://github.com/ryanrasti/exoagent/blob/735f6c01fed29d8b7bba9c809c245e7fd6d5fe9e/website/worker/index.ts#L20-L52" className="text-green-400 hover:underline">what you've exposed</a>
            .
          </p>
          <p className="text-neutral-400 text-sm">
            In this demo, the agent's code runs in your browser via
            {' '}
            <a href="https://github.com/cloudflare/capnweb" className="text-green-400 hover:underline">Cap'n Web</a>
            ,
            an object-capability RPC layer.*
          </p>
          <p className="text-neutral-500 text-xs mt-2">
            * Patched to serialize closures — PR upstream coming soon.
          </p>
        </div>
      </section>

      <section className="px-8 py-12 bg-neutral-900/50 border-t border-neutral-800">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold mb-6">What's the industry doing?</h2>
          <ul className="space-y-4 text-neutral-300">
            <li className="flex gap-3">
              <span className="text-amber-500">•</span>
              <div>
                <strong className="text-neutral-100">Prompt Engineering</strong>
                <span className="text-neutral-400"> — "NEVER reveal the secret" in all caps. Cat and mouse forever.</span>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="text-amber-500">•</span>
              <div>
                <strong className="text-neutral-100">RLHF / Training</strong>
                <span className="text-neutral-400"> — Helps, but determined attackers bypass it. Models are trained to be helpful, which is the vulnerability.</span>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="text-amber-500">•</span>
              <div>
                <strong className="text-neutral-100">Guardrails / Classifiers</strong>
                <span className="text-neutral-400"> — Another LLM checking the first. Probabilistic security isn't security.</span>
              </div>
            </li>
          </ul>
        </div>
      </section>

      <section className="px-8 py-12 border-t border-neutral-800">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold mb-6">How ExoAgent works</h2>
          <p className="text-neutral-300 mb-4">
            Just like on your device, agents need OS kernel primitives for better flexibility, reliability, and security.
            ExoAgent's thesis: give your agent an interface that is
            {' '}
            <strong className="text-neutral-100">secure by construction</strong>
            .
            It obeys rules as invariants — doesn't matter if the model hallucinates or gets subverted.
          </p>
          <p className="text-neutral-400 mb-6">
            Three primitives guide the architecture:
          </p>
          <ul className="space-y-3 text-neutral-300 mb-8">
            <li className="flex gap-3">
              <span className="text-green-500">•</span>
              <div>
                <strong className="text-neutral-100">Object-capability tools</strong>
                <span className="text-neutral-400"> — The syscall layer, flexible enough for dynamic agents, constrained by design</span>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="text-green-500">•</span>
              <div>
                <strong className="text-neutral-100">Semantic interfaces</strong>
                <span className="text-neutral-400">
                  {' '}
                  — The compiler with
                  <code className="bg-neutral-800 px-1.5 py-0.5 rounded text-sm">unsafe</code>
                  {' '}
                  forbidden
                </span>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="text-green-500">•</span>
              <div>
                <strong className="text-neutral-100">Central policy</strong>
                <span className="text-neutral-400"> — seccomp for AI — and humans too</span>
              </div>
            </li>
          </ul>
          <div className="flex gap-4">
            <a
              href={GITHUB_URL}
              className="px-6 py-3 bg-green-600 hover:bg-green-500 text-black font-bold rounded-lg transition-colors"
            >
              View on GitHub →
            </a>
          </div>
        </div>
      </section>
    </Layout>
  )
}
