import React from 'react'
import { GitHubLink, Layout } from './Layout'

export function Terms() {
  return (
    <Layout headerRight={<GitHubLink>Star on GitHub</GitHubLink>}>
      <section className="px-8 py-12 max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Bounty Terms</h1>

        <div className="space-y-8 text-neutral-300">
          <div>
            <h2 className="text-xl font-bold text-neutral-100 mb-3">The Challenge</h2>
            <p>
              Extract the BTC private key from the ExoAgent-protected database. The key is stored in the same
              database schema as the Raw SQL agent, but accessed through the ExoAgent capability-constrained interface.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-bold text-neutral-100 mb-3">Bounties</h2>
            <ul className="list-disc list-inside space-y-2">
              <li>
                <span className="text-red-400 font-bold">~$20</span>
                {' '}
                <span className="text-neutral-500">(0.00024 BTC)</span>
                {' '}
                — Raw SQL Agent
              </li>
              <li>
                <span className="text-green-400 font-bold">~$1,000</span>
                {' '}
                <span className="text-neutral-500">(0.012 BTC)</span>
                {' '}
                — ExoAgent Protected
              </li>
            </ul>
            <p className="mt-3 text-neutral-400">
              The bounty is the BTC itself. If you extract the private key, the funds at that address are yours.
            </p>
            <p className="mt-2 text-neutral-500 text-sm">
              USD values are approximate, based on ~$85k/BTC. Actual value fluctuates with market price.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-bold text-neutral-100 mb-3">Claiming</h2>
            <p className="mb-3">
              First come, first serve. Once you have the private key, the BTC is yours to transfer.
            </p>
            <p>
              If you successfully extract the ExoAgent bounty, we'd love to hear from you:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>
                Email
                {' '}
                <a href="mailto:ryanrasti@gmail.com" className="text-green-400 hover:underline">ryanrasti@gmail.com</a>
              </li>
              <li>Include a signed message using the extracted private key to verify your claim</li>
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-bold text-neutral-100 mb-3">Verification</h2>
            <p>
              BTC private keys can sign arbitrary messages. To verify your claim, sign a message containing
              your email and the date of extraction. We can verify this signature against the bounty wallet's
              public address.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-bold text-neutral-100 mb-3">Disclosure</h2>
            <p>
              If you find a vulnerability in ExoAgent (whether or not you extract the key), please
              report it to
              {' '}
              <a href="mailto:ryanrasti@gmail.com" className="text-green-400 hover:underline">ryanrasti@gmail.com</a>
              .
              We welcome responsible disclosure and may offer additional rewards for novel attack vectors.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-bold text-neutral-100 mb-3">Limitations</h2>
            <ul className="list-disc list-inside space-y-2">
              <li>One bounty payout per wallet. Once claimed, the funds are gone.</li>
              <li>We reserve the right to modify these terms without notice.</li>
              <li>We reserve the right to pause or discontinue the bounty at any time.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-bold text-neutral-100 mb-3">Scope</h2>
            <p className="mb-3">
              Attacking the challenge interface on this page is authorized. The following are strictly prohibited:
            </p>
            <ul className="list-disc list-inside space-y-1 text-neutral-400">
              <li>Attacking upstream providers (Cloudflare, Google, etc.)</li>
              <li>Attacking other users or their sessions</li>
              <li>Denial of service attacks</li>
              <li>Social engineering</li>
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-bold text-neutral-100 mb-3">The Prize</h2>
            <p>
              The bounty is awarded to the first person to extract the key and move the funds.
              We are not responsible for blockchain race conditions or front-running bots.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-bold text-neutral-100 mb-3">Data</h2>
            <p>
              We may publish chat logs. Do not input personally identifiable information (PII).
            </p>
          </div>

          <div>
            <h2 className="text-xl font-bold text-neutral-100 mb-3">Legal</h2>
            <ul className="list-disc list-inside space-y-2">
              <li>This challenge is provided "as is" without warranty of any kind. Participate at your own risk.</li>
              <li>We are not liable for any damages arising from your participation in this challenge.</li>
              <li>By participating, you agree not to hold ExoAgent, its creators, or affiliates liable for any losses.</li>
              <li>We will not pursue legal action against participants acting in good faith within the scope of this challenge.</li>
            </ul>
          </div>

          <div className="pt-4 border-t border-neutral-800 text-neutral-500 text-sm">
            <p>
              Questions? Reach out at
              {' '}
              <a href="mailto:ryanrasti@gmail.com" className="text-green-400 hover:underline">ryanrasti@gmail.com</a>
            </p>
          </div>
        </div>
      </section>
    </Layout>
  )
}
