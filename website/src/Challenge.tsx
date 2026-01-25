import type { Api } from '../worker/index'
import type { Leaderboard } from './AgentChat'
import { Turnstile } from '@marsidev/react-turnstile'
import { newHttpBatchRpcSession } from 'capnweb'
import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import { ExoAgentChat, RawSqlAgentChat } from './AgentChat'
import { GITHUB_URL, GitHubLink, Layout } from './Layout'
import { formatRelativeTime } from './utils'

// Turnstile site keys - use dev key for localhost
const TURNSTILE_SITE_KEY = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? '1x00000000000000000000AA' // Cloudflare's always-passing test key
  : '0x4AAAAAACOkZEmVkdZMbJ9s'

const statColors = {
  red: { text: 'text-red-500', bg: 'bg-red-500/20' },
  green: { text: 'text-green-500', bg: 'bg-green-500/20' },
  neutral: { text: 'text-neutral-400', bg: 'bg-neutral-500/20' },
}

function StatCard({ value, color, label }: { value: number | undefined, color: keyof typeof statColors, label: string }) {
  const { text, bg } = statColors[color]
  const prevValueRef = useRef(value)
  const [pulse, setPulse] = useState(false)

  useEffect(() => {
    if (prevValueRef.current != null && value !== prevValueRef.current) {
      setPulse(true)
      const timer = setTimeout(() => setPulse(false), 300)
      return () => clearTimeout(timer)
    }
    prevValueRef.current = value
  }, [value])

  return (
    <div className="text-center">
      <div className={`text-3xl font-bold ${text} transition-transform duration-300 ${pulse ? 'scale-125' : ''}`}>
        {value != null ? value.toLocaleString() : <span className={`inline-block w-8 h-8 ${bg} rounded animate-pulse`} />}
      </div>
      <div className="text-sm text-neutral-500">{label}</div>
    </div>
  )
}

// Kill feed ticker - continuous marquee with relative timestamps
function ActivityTicker({ leaderboard }: { leaderboard: Leaderboard | undefined }) {
  const [, forceUpdate] = useState(0)

  // Update relative times every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => forceUpdate(n => n + 1), 10000)
    return () => clearInterval(interval)
  }, [])

  // Empty space while loading or no entries
  if (!leaderboard?.recent.length) {
    return <div className="h-5" />
  }

  // Duplicate entries for seamless looping
  const entries = leaderboard.recent.slice(0, 10)
  const duplicatedEntries = [...entries, ...entries]

  return (
    <div className="overflow-hidden whitespace-nowrap text-sm h-5">
      <div className="inline-flex gap-6 animate-ticker-continuous pl-[100%]">
        {duplicatedEntries.map((entry, i) => (
          <span key={`${entry.claimedAt}-${i}`} className="text-neutral-400">
            <span className="text-red-500">💀</span>
            {' '}
            <span className="text-red-400">{entry.username}</span>
            {' '}
            hacked Raw SQL
            {' '}
            <span className="text-neutral-600">{formatRelativeTime(entry.claimedAt)}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

// Big bounty alert - only for the $1000 ExoAgent bounty being claimed
function BigBountyClaimedAlert({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 10000)
    return () => clearTimeout(timer)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 animate-fade-in">
      <div className="bg-green-950 border-2 border-green-500 rounded-xl p-8 shadow-2xl text-center animate-bounce-in">
        <div className="text-6xl mb-4">🚨</div>
        <div className="text-2xl font-bold text-green-400 mb-2">EXOAGENT HACKED!</div>
        <div className="text-xl text-neutral-200 mb-4">
          Someone just drained the ExoAgent bounty wallet!
        </div>
        <div className="text-neutral-400 text-sm">The ~$1,000 bounty has been claimed</div>
        <button onClick={onClose} className="mt-6 px-6 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-neutral-200">
          Dismiss
        </button>
      </div>
    </div>
  )
}

// Wallet drained alert - shown when Raw SQL bounty is claimed
function WalletDrainedAlert({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 10000)
    return () => clearTimeout(timer)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 animate-fade-in">
      <div className="bg-red-950 border-2 border-red-500 rounded-xl p-8 shadow-2xl text-center animate-bounce-in">
        <div className="text-6xl mb-4 animate-pulse">💸</div>
        <div className="text-2xl font-bold text-red-400 mb-2">WALLET DRAINED!</div>
        <div className="text-xl text-neutral-200 mb-4">
          Someone just extracted the private key and swept the funds!
        </div>
        <button onClick={onClose} className="mt-6 px-6 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-neutral-200">
          Dismiss
        </button>
      </div>
    </div>
  )
}

// Unified bounty display with live BTC balance and mempool link
function BountyAmount({
  wallet,
  color,
  isLive,
}: {
  wallet: { balanceSats: number, expectedSats: number, address: string } | undefined
  color: 'red' | 'green'
  isLive: boolean
}) {
  const styles = {
    red: { text: 'text-red-400', bg: 'bg-red-500/20' },
    green: { text: 'text-green-400', bg: 'bg-green-500/20' },
  }[color]

  if (!wallet) {
    return <span className={`inline-block w-20 h-4 ${styles.bg} rounded animate-pulse`} />
  }

  const { balanceSats, expectedSats, address } = wallet
  // Drained if <10% of expected
  const isDrained = balanceSats < expectedSats * 0.1
  const btc = expectedSats / 100_000_000
  // Rough dollar estimate based on ~$85k/BTC
  const dollarAmount = `~$${Math.round(expectedSats / 100_000_000 * 85000).toLocaleString()}`
  const statusLabel = isDrained ? (isLive ? 'DRAINED' : 'unfunded') : null

  return (
    <>
      {statusLabel && (
        <span className={`${styles.text} font-bold`}>
          {statusLabel}
          {' '}
        </span>
      )}
      <span className={isDrained ? 'text-neutral-500 line-through' : styles.text}>{dollarAmount}</span>
      {' '}
      <a
        href={`https://mempool.space/address/${address}`}
        target="_blank"
        rel="noopener noreferrer"
        className={`text-xs hover:text-neutral-400 underline ${isDrained ? 'text-neutral-600' : 'text-neutral-500'}`}
      >
        (
        <span className={isDrained ? 'line-through' : ''}>{btc.toFixed(5)}</span>
        {' '}
        BTC)
      </a>
    </>
  )
}

export function Challenge() {
  const [hideTurnstile, setHideTurnstile] = useState(false)
  const [nonce] = useState(crypto.randomUUID())
  const [showBigBountyAlert, setShowBigBountyAlert] = useState(false)
  const [showDrainedAlert, setShowDrainedAlert] = useState(false)
  const { current: { promise: sessionIdPromise, resolve: sessionIdResolve, reject: sessionIdReject } } = useRef(Promise.withResolvers<string>())
  const prevRawSqlBalanceRef = useRef<number | null>(null)
  const prevExoagentBalanceRef = useRef<number | null>(null)

  // SWR for polling stats (no session required, available on Api)
  const { data: stats } = useSWR(
    'stats',
    async () => {
      using api = newHttpBatchRpcSession<Api>('/api/bounty/rpc')
      return await api.stats()
    },
    { refreshInterval: 5000, revalidateOnFocus: true },
  )

  // Detect drain and show alerts (only if live and we observe the transition)
  const rawSqlWallet = stats?.wallets.rawSql
  const exoagentWallet = stats?.wallets.exoagent

  useEffect(() => {
    if (stats?.isLive && rawSqlWallet) {
      const prev = prevRawSqlBalanceRef.current
      // Show alert if previous fetch was >= 10% and now it's < 10%
      if (prev != null && prev >= rawSqlWallet.expectedSats * 0.1 && rawSqlWallet.balanceSats < rawSqlWallet.expectedSats * 0.1) {
        setShowDrainedAlert(true)
      }
      prevRawSqlBalanceRef.current = rawSqlWallet.balanceSats
    }
  }, [stats?.isLive, rawSqlWallet])

  useEffect(() => {
    if (stats?.isLive && exoagentWallet) {
      const prev = prevExoagentBalanceRef.current
      // Show alert if previous fetch was >= 10% and now it's < 10%
      if (prev != null && prev >= exoagentWallet.expectedSats * 0.1 && exoagentWallet.balanceSats < exoagentWallet.expectedSats * 0.1) {
        setShowBigBountyAlert(true)
      }
      prevExoagentBalanceRef.current = exoagentWallet.balanceSats
    }
  }, [stats?.isLive, exoagentWallet])

  return (
    <Layout headerRight={<GitHubLink>Star on GitHub</GitHubLink>}>
      {/* Alerts */}
      {showBigBountyAlert && <BigBountyClaimedAlert onClose={() => setShowBigBountyAlert(false)} />}
      {showDrainedAlert && <WalletDrainedAlert onClose={() => setShowDrainedAlert(false)} />}

      {/* Turnstile challenge - centered when visible */}
      {!hideTurnstile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none *:pointer-events-auto">
          <Turnstile
            siteKey={TURNSTILE_SITE_KEY}
            onSuccess={(val) => {
              setHideTurnstile(true)
              sessionIdResolve((async () => {
                const api = newHttpBatchRpcSession<Api>('/api/bounty/rpc')
                return await api.newSession({ turnstileId: val, nonce })
              })())
            }}
            onError={(error) => {
              sessionIdReject(new Error(error))
            }}
            options={{ theme: 'dark', appearance: 'interaction-only' }}
          />
        </div>
      )}

      {/* Hero */}
      <section className="px-8 py-12 max-w-6xl mx-auto">
        <h1 className="text-4xl md:text-5xl font-bold text-center mb-4">
          Hack this agent. Win Bitcoin.
          {stats && !stats.isLive && <span className="ml-3 text-lg font-normal text-amber-500 align-middle">(v0.1 preview)</span>}
        </h1>
        <p className="text-xl text-neutral-400 text-center max-w-2xl mx-auto mb-4">
          Both agents have the same LLM, same database, same prompt injection vulnerability.
          Only one can be exploited.
        </p>
        <p className="text-lg text-amber-500 text-center max-w-2xl mx-auto mb-4">
          Extract the private key from the ExoAgent database and the
          {' '}
          <span className="font-bold">BTC is yours</span>
          .*
        </p>
        <p className="text-sm text-neutral-500 text-center">
          <Link to="/terms" className="hover:text-neutral-400 underline">*Bounty terms</Link>
        </p>
      </section>

      {/* Stats bar with ticker */}
      <section className="px-8 py-4 bg-neutral-900 border-y border-neutral-800">
        <div className="max-w-6xl mx-auto">
          <div className="flex justify-center gap-12 mb-3">
            <StatCard value={stats?.hackCount} color="red" label="Times Raw SQL hacked" />
            <StatCard value={stats ? 0 : undefined} color="green" label="Times ExoAgent hacked" />
            <StatCard value={stats?.attemptCount} color="neutral" label="ExoAgent hack attempts" />
          </div>
          <ActivityTicker leaderboard={stats?.leaderboard} />
        </div>
      </section>
      {/* Side-by-side agents */}
      <section className="px-8 py-12 max-w-7xl mx-auto">
        <div className="grid md:grid-cols-2 gap-8">
          {/* Raw SQL Agent (Hackable) */}
          <div className="border border-red-900/50 rounded-xl overflow-hidden bg-neutral-900/50">
            <div className="px-6 py-4 border-b bg-red-950/30 border-red-900/50">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-2xl">💀</span>
                <h2 className="text-xl font-bold text-red-400">Raw SQL Agent</h2>
              </div>
              <p className="text-sm text-neutral-400">
                Standard LLM with direct SQL access.
                {' '}
                <BountyAmount
                  wallet={stats?.wallets.rawSql}
                  color="red"
                  isLive={stats?.isLive ?? false}
                />
              </p>
            </div>
            <RawSqlAgentChat sessionIdPromise={sessionIdPromise} leaderboard={stats?.leaderboard} isLive={stats?.isLive ?? false} />
          </div>

          {/* ExoAgent (Protected) */}
          <div className="border border-green-900/50 rounded-xl overflow-hidden bg-neutral-900/50">
            <div className="px-6 py-4 border-b bg-green-950/30 border-green-900/50">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-2xl">🛡️</span>
                <h2 className="text-xl font-bold text-green-400">ExoAgent Protected</h2>
              </div>
              <p className="text-sm text-neutral-400">
                Same LLM, execution-layer security.
                {' '}
                <BountyAmount
                  wallet={stats?.wallets.exoagent}
                  color="green"
                  isLive={stats?.isLive ?? false}
                />
              </p>
            </div>
            <ExoAgentChat sessionIdPromise={sessionIdPromise} isLive={stats?.isLive ?? false} />
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
                  {' '}
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
