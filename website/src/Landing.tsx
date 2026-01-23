import React from 'react'
import { Link } from 'react-router-dom'

export function Landing() {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      {/* Header */}
      <header className="border-b border-neutral-800 px-8 py-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <img src="/logo-hex-shield-animated.svg" alt="ExoAgent" className="w-8 h-8" />
          <span className="font-bold text-lg">ExoAgent</span>
        </div>
        <div className="flex items-center gap-4">
          <Link
            to="/challenge"
            className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-black font-medium rounded-lg transition-colors"
          >
            Try the Challenge →
          </Link>
          <a
            href="https://github.com/ryanrasti/exoagent"
            className="flex items-center gap-2 px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
            <span>GitHub</span>
          </a>
        </div>
      </header>

      {/* Hero */}
      <section className="px-8 py-24 max-w-4xl mx-auto text-center">
        <h1 className="text-5xl md:text-6xl font-bold mb-6">
          Secure tool execution for AI agents
        </h1>
        <p className="text-xl text-neutral-400 mb-8 max-w-2xl mx-auto">
          LLMs can be prompt-injected. ExoAgent ensures that even a compromised agent
          can only perform authorized operations.
        </p>
        <div className="flex gap-4 justify-center">
          <Link
            to="/challenge"
            className="px-8 py-4 bg-green-600 hover:bg-green-500 text-black font-bold text-lg rounded-lg transition-colors"
          >
            Try to hack it →
          </Link>
          <a
            href="https://github.com/ryanrasti/exoagent"
            className="px-8 py-4 bg-neutral-800 hover:bg-neutral-700 font-medium text-lg rounded-lg transition-colors"
          >
            View docs
          </a>
        </div>
      </section>

      {/* Problem */}
      <section className="px-8 py-16 bg-neutral-900/50 border-y border-neutral-800">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold mb-6">The problem</h2>
          <p className="text-neutral-300 text-lg mb-4">
            AI agents need tools to be useful—database access, API calls, file operations.
            But LLMs can't distinguish between instructions and data. A malicious input can
            hijack the agent's actions.
          </p>
          <p className="text-neutral-400">
            Prompt engineering, guardrails, and content filters help, but they're probabilistic.
            Determined attackers find bypasses. The attack surface is in-band with the model itself.
          </p>
        </div>
      </section>

      {/* Solution */}
      <section className="px-8 py-16">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold mb-6">The fix</h2>
          <p className="text-neutral-300 text-lg mb-4">
            ExoAgent enforces security at the
            {' '}
            <strong className="text-white">execution layer</strong>
            , not the prompt layer. The agent can ask for anything—but only authorized operations execute.
          </p>
          <p className="text-neutral-300 mb-6">
            Instead of raw SQL, agents get a capability-based query builder. They compose queries
            through a type-safe DSL that physically cannot access unauthorized data. Not because
            we told the LLM "don't do that"—because the operation doesn't exist.
          </p>
          <div className="bg-neutral-900 rounded-lg p-6 font-mono text-sm">
            <div className="text-neutral-500 mb-2">// Agent can only access what you expose</div>
            <div className="text-green-400">api.users()</div>
            <div className="text-neutral-400 ml-4">.where(u =&gt; u.id['='](currentUserId))</div>
            <div className="text-neutral-400 ml-4">
              .select(u =&gt; (
              {'{ '}
              name: u.name, email: u.email
              {' }'}
              )
            </div>
            <div className="text-neutral-400 ml-4">.execute()</div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-8 py-16 bg-neutral-900/50 border-t border-neutral-800">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">See it in action</h2>
          <p className="text-neutral-400 mb-8">
            We're so confident in ExoAgent that we're offering a bounty.
            Hack the protected agent and the BTC is yours.
          </p>
          <Link
            to="/challenge"
            className="inline-block px-8 py-4 bg-amber-600 hover:bg-amber-500 text-black font-bold text-lg rounded-lg transition-colors"
          >
            Take the Challenge →
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-8 py-8 border-t border-neutral-800 text-center text-neutral-500 text-sm">
        <p>ExoAgent — Execution-layer security for AI agents</p>
      </footer>
    </div>
  )
}
