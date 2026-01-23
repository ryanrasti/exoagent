import { Highlight, themes } from 'prism-react-renderer'
import React from 'react'
import { Link } from 'react-router-dom'
import { GITHUB_URL, GitHubLink, Layout } from './Layout'

function CodeBlock({ code, language }: { code: string, language: string }) {
  return (
    <Highlight theme={themes.nightOwl} code={code.trim()} language={language}>
      {({ style, tokens, getLineProps, getTokenProps }) => (
        <pre className="text-sm overflow-x-auto" style={{ ...style, background: 'transparent' }}>
          {tokens.map((line, i) => (
            <div key={i} {...getLineProps({ line })}>
              {line.map((token, key) => (
                <span key={key} {...getTokenProps({ token })} />
              ))}
            </div>
          ))}
        </pre>
      )}
    </Highlight>
  )
}

export function Landing() {
  return (
    <Layout
      headerRight={(
        <div className="flex items-center gap-4">
          <Link
            to="/challenge"
            className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-black font-medium rounded-lg transition-colors"
          >
            Try the Challenge
          </Link>
          <GitHubLink>GitHub</GitHubLink>
        </div>
      )}
    >
      {/* Hero */}
      <section className="px-8 py-24 max-w-4xl mx-auto text-center">
        <h1 className="text-5xl md:text-6xl font-bold mb-6">
          The
          {' '}
          <span className="relative inline-block animate-[kernelGlow_0.75s_ease-out_forwards]">
            <span className="absolute -inset-1 rounded-lg blur-sm animate-[kernelBg_0.75s_ease-out_forwards]" />
            <span className="relative">OS Kernel</span>
          </span>
          {' '}
          to
          {' '}
          <span className="relative inline-block animate-[safelyGlow_0.75s_ease-out_forwards]">
            <span className="absolute -inset-1 rounded-lg blur-sm animate-[safelyBg_0.75s_ease-out_forwards]" />
            <span className="relative">Safely</span>
          </span>
          {' '}
          <span className="relative inline-block animate-[unleashGlow_0.75s_ease-out_forwards]">
            <span className="absolute -inset-1 rounded-lg blur-sm animate-[unleashBg_0.75s_ease-out_forwards]" />
            <span className="relative">Unleash Your Agents</span>
          </span>
        </h1>
        <p className="text-xl text-neutral-400 mb-8 max-w-2xl mx-auto">
          More flexibility for agents. Tighter controls for you.
        </p>
        <div className="flex gap-4 justify-center">
          <Link
            to="/challenge"
            className="px-8 py-4 bg-amber-600 hover:bg-amber-500 text-black font-bold text-lg rounded-lg transition-colors"
          >
            Try to break it
          </Link>
          <a
            href={GITHUB_URL}
            className="px-8 py-4 bg-neutral-800 hover:bg-neutral-700 font-medium text-lg rounded-lg transition-colors"
          >
            View on GitHub
          </a>
        </div>
      </section>

      {/* Problem */}
      <section className="px-8 py-16 bg-neutral-900/50 border-y border-neutral-800">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold mb-6">The Problem</h2>
          <p className="text-neutral-300 text-lg mb-8">
            Today's agent frameworks give LLMs raw access to tools. The "security model" is hoping the prompt works.
          </p>

          <div className="space-y-8">
            {/* Crisis 1 */}
            <div className="border-l-2 border-red-500/50 pl-6">
              <h3 className="text-xl font-semibold mb-2 text-red-400">Authorization is broken</h3>
              <p className="text-neutral-400 mb-2">
                Tool calls inherit user permissions. Your agent gets your credentials — all of them.
              </p>
              <p className="text-neutral-500 italic">
                You asked for dinner delivery. Your driver got your wallet.
              </p>
            </div>

            {/* Crisis 2 */}
            <div className="border-l-2 border-orange-500/50 pl-6">
              <h3 className="text-xl font-semibold mb-2 text-orange-400">Interfaces are opaque</h3>
              <p className="text-neutral-400 mb-2">
                <code className="bg-neutral-800 px-2 py-1 rounded text-sm">execute_sql("SELECT * FROM users")</code>
                {' '}
                — policy can't see what's inside.
              </p>
              <p className="text-neutral-500 italic">
                Rich interfaces hidden in strings. No way to enforce constraints.
              </p>
            </div>

            {/* Crisis 3 */}
            <div className="border-l-2 border-yellow-500/50 pl-6">
              <h3 className="text-xl font-semibold mb-2 text-yellow-400">No central data policy</h3>
              <p className="text-neutral-400 mb-2">
                You have a simple rule: "don't leak PII". Your implementation is patchwork and guesses.
              </p>
              <p className="text-neutral-500 italic">
                Each tool enforces its own rules. No holistic view. No real guarantees.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Solution */}
      <section className="px-8 py-16">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold mb-6">The Fix</h2>
          <p className="text-neutral-300 text-lg mb-4">
            Security as a
            {' '}
            <strong className="text-white">system invariant</strong>
            , not a polite suggestion.
          </p>
          <p className="text-neutral-400 mb-8">
            Applying timeless systems security principles to this new domain:
          </p>

          <div className="space-y-6 mb-10">
            <div className="flex gap-4">
              <div className="text-green-500 text-xl">&#10003;</div>
              <div>
                <h3 className="font-semibold text-white">Object-capability tools</h3>
                <p className="text-neutral-400">The syscall layer — flexible enough for dynamic agents, constrained by design</p>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="text-green-500 text-xl">&#10003;</div>
              <div>
                <h3 className="font-semibold text-white">Semantic interfaces</h3>
                <p className="text-neutral-400">
                  The compiler with
                  <code className="bg-neutral-800 px-1.5 py-0.5 rounded text-sm">unsafe</code>
                  {' '}
                  forbidden
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="text-green-500 text-xl">&#10003;</div>
              <div>
                <h3 className="font-semibold text-white">Central policy</h3>
                <p className="text-neutral-400">seccomp for AI — and humans too</p>
              </div>
            </div>
          </div>

          {/* Code comparison */}
          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-neutral-900 rounded-lg overflow-hidden border border-red-500/30">
              <div className="bg-red-950/50 px-5 py-3 border-b border-red-500/30 flex items-center gap-2">
                <span className="text-red-400">✗</span>
                <span className="text-red-400 text-sm font-medium">Before: policy as a polite suggestion</span>
              </div>
              <div className="p-5">
                <CodeBlock
                  language="javascript"
                  code={`const result = await generateText({
  tools: { db: sqlTool, slack: postToSlack },
  model,
  prompt: \`
...
Here is the schema:
CREATE TABLE customers (
  id,
  name,
  home_address  -- this is PII
);
CREATE TABLE orders (id, customer_id);

IMPORTANT:
- Only query orders the customer has access to
- Don't leak PII to Slack, PRETTY PLEASE
\`
})`}
                />
              </div>
            </div>
            <div className="bg-neutral-900 rounded-lg overflow-hidden border border-green-500/30">
              <div className="bg-green-950/50 px-5 py-3 border-b border-green-500/30 flex items-center gap-2">
                <span className="text-green-400">✓</span>
                <span className="text-green-400 text-sm font-medium">The vision: policy as code invariants</span>
              </div>
              <div className="p-5">
                <CodeBlock
                  language="typescript"
                  code={`class Customer extends RpcToolset {
  id = this.column('id')
  name = this.column('name')
  @policy.source('pii')
  homeAddress = this.column('home_address')

  orders() {
    return Order.on(o => o.customerId.eq(this.id))
  }
}

@policy.sink('external')
function postToSlack(msg: string) { /* ... */ }

policy.deny({
  source: 'pii',
  sink: 'external'
})`}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="px-8 py-16 bg-neutral-900/50 border-t border-neutral-800">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold mb-8">What about...?</h2>
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold text-white mb-2">Prompt Engineering</h3>
              <p className="text-neutral-400">
                "NEVER reveal the secret" in all caps. Cat and mouse forever.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-white mb-2">RLHF / Training</h3>
              <p className="text-neutral-400">
                Helps, but determined attackers bypass it. Models are trained to be helpful — that's the vulnerability.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-white mb-2">Guardrails / Classifiers</h3>
              <p className="text-neutral-400">
                Another LLM checking the first. Probabilistic security isn't security.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-8 py-16 border-t border-neutral-800">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">See it in action</h2>
          <p className="text-neutral-400 mb-8 max-w-xl mx-auto">
            We built a demo with two agents: one with raw SQL access, one with ExoAgent.
            Try to extract data you shouldn't have access to.
          </p>
          <Link
            to="/challenge"
            className="inline-block px-8 py-4 bg-amber-600 hover:bg-amber-500 text-black font-bold text-lg rounded-lg transition-colors"
          >
            Take the Challenge
          </Link>
        </div>
      </section>
    </Layout>
  )
}
