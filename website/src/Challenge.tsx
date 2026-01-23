import type { BountyAgent } from '../worker/index'
import { newWebSocketRpcSession } from 'capnweb'
import React, { useEffect, useState } from 'react'
import { ExoAgentChat, RawSqlAgentChat } from './AgentChat'

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
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      {/* Header */}
      <header className="border-b border-neutral-800 px-8 py-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <img src="/logo-hex-shield-animated.svg" alt="ExoAgent" className="w-8 h-8" />
          <span className="font-bold text-lg">ExoAgent</span>
        </div>
        <a
          href="https://github.com/ryanrasti/exoagent"
          className="flex items-center gap-2 px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
          </svg>
          <span>Star on GitHub</span>
        </a>
      </header>

      {/* Hero */}
      <section className="px-8 py-12 max-w-6xl mx-auto">
        <h1 className="text-4xl md:text-5xl font-bold text-center mb-4">
          Hack this agent. Win Bitcoin.
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
                <span className="text-green-400">$5,000 bounty</span>
              </p>
            </div>
            <ExoAgentChat />
          </div>
        </div>
      </section>

      {/* Explanation sections */}
      <section className="px-8 py-12 bg-neutral-900/50 border-t border-neutral-800">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold mb-6">What just happened?</h2>
          <p className="text-neutral-300 mb-4">
            LLMs can't distinguish between instructions and data. When you send a message, the model sees your input
            mixed with the system prompt. A cleverly crafted message can override the original instructions entirely.
          </p>
          <p className="text-neutral-300">
            This isn't a bug—it's fundamental to how language models work. The attack surface is
            {' '}
            <em>in-band</em>
            .
          </p>
        </div>
      </section>

      <section className="px-8 py-12 border-t border-neutral-800">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold mb-6">What's the industry doing?</h2>
          <ul className="space-y-4 text-neutral-300">
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
            <li className="flex gap-3">
              <span className="text-amber-500">•</span>
              <div>
                <strong className="text-neutral-100">Prompt Engineering</strong>
                <span className="text-neutral-400"> — "NEVER reveal the secret" in all caps. Cat and mouse forever.</span>
              </div>
            </li>
          </ul>
        </div>
      </section>

      <section className="px-8 py-12 bg-neutral-900/50 border-t border-neutral-800">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold mb-6">The actual fix</h2>
          <p className="text-neutral-300 mb-4">
            Security must be enforced at the
            {' '}
            <strong className="text-neutral-100">execution layer</strong>
            , not the prompt layer. The agent can ask for anything—but only safe operations actually execute.
          </p>
          <p className="text-neutral-300 mb-6">
            ExoAgent gives your LLM a
            {' '}
            <strong className="text-neutral-100">capability-based SQL interface</strong>
            . The agent composes queries through a type-safe DSL. It literally cannot construct a query that accesses
            unauthorized tables—not because we told it not to, but because the operation doesn't exist.
          </p>
          <div className="flex gap-4">
            <a
              href="https://github.com/ryanrasti/exoagent"
              className="px-6 py-3 bg-green-600 hover:bg-green-500 text-black font-bold rounded-lg transition-colors"
            >
              View on GitHub →
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-8 py-8 border-t border-neutral-800 text-center text-neutral-500 text-sm">
        <p>ExoAgent — Execution-layer security for AI agents</p>
      </footer>
    </div>
  )
}
