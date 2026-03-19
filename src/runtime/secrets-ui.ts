import type { Component } from '@mariozechner/pi-tui'
import type { Secrets } from './providers/secrets'
import { Input, ProcessTerminal, SelectList, TUI } from '@mariozechner/pi-tui'

/**
 * Secret declaration — providers declare what secrets they need.
 */
export interface SecretDecl {
  name: string
  required: boolean
  description: string
}

export interface ProviderSecrets {
  provider: string
  secrets: SecretDecl[]
}

/** Known providers and their secrets */
export const PROVIDER_SECRETS: ProviderSecrets[] = [
  {
    provider: 'review',
    secrets: [
      { name: 'GITHUB_TOKEN', required: true, description: 'GitHub API token for PR operations' },
    ],
  },
]

/**
 * Interactive TUI for managing secrets.
 */
export async function runSecretsUI(db: Secrets): Promise<void> {
  const terminal = new ProcessTerminal()
  const tui = new TUI(terminal, true)

  return new Promise<void>((resolve) => {
    let selectedProvider: ProviderSecrets | null = null
    let selectedSecret: SecretDecl | null = null

    const theme = {
      selectedPrefix: (t: string) => `\x1B[7m${t}\x1B[0m`,
      selectedText: (t: string) => `\x1B[1m${t}\x1B[0m`,
      description: (t: string) => `\x1B[2m${t}\x1B[0m`,
      scrollInfo: (t: string) => `\x1B[2m${t}\x1B[0m`,
      noMatch: (t: string) => `\x1B[2m${t}\x1B[0m`,
    }

    const header: Component = {
      render: () => ['', '\x1B[1mSecrets\x1B[0m — Select a provider (Enter to configure, Esc/q to exit)', ''],
      invalidate: () => {},
    }

    const buildProviderItems = () => PROVIDER_SECRETS.map((p) => {
      const missing = p.secrets.filter(s => s.required && !db.get(p.provider, s.name))
      const icon = missing.length > 0 ? '\x1B[31m●\x1B[0m' : '\x1B[32m●\x1B[0m'
      const status = missing.length > 0 ? `${missing.length} required missing` : 'configured'
      return { value: p.provider, label: `${icon} ${p.provider}`, description: status }
    })

    const buildSecretItems = (p: ProviderSecrets) => p.secrets.map((s) => {
      const value = db.get(p.provider, s.name)
      const icon = value ? '\x1B[32m✓\x1B[0m' : (s.required ? '\x1B[31m✗\x1B[0m' : '\x1B[33m-\x1B[0m')
      const display = value ? `${value.slice(0, 8)}${'*'.repeat(Math.min(8, value.length - 8))}` : '(not set)'
      return { value: s.name, label: `${icon} ${s.name}`, description: `${display}  ${s.description}` }
    })

    const done = () => {
      tui.stop()
      resolve()
    }

    // -- Views ---------------------------------------------------------------

    const showProviders = () => {
      for (const c of [...tui.children]) {
        tui.removeChild(c)
      }
      tui.addChild(header)
      const list = new SelectList(buildProviderItems(), 15, theme)
      list.onSelect = (item) => {
        selectedProvider = PROVIDER_SECRETS.find(p => p.provider === item.value) ?? null
        if (selectedProvider) {
          showSecrets(selectedProvider)
        }
      }
      list.onCancel = done
      tui.addChild(list)
      tui.setFocus(list)
    }

    const showSecrets = (provider: ProviderSecrets) => {
      for (const c of [...tui.children]) {
        tui.removeChild(c)
      }
      const secretHeader: Component = {
        render: () => ['', `\x1B[1mSecrets\x1B[0m — ${provider.provider} (Enter to set, Esc to go back, Del to clear)`, ''],
        invalidate: () => {},
      }
      tui.addChild(secretHeader)
      const list = new SelectList(buildSecretItems(provider), 15, theme)
      list.onSelect = (item) => {
        selectedSecret = provider.secrets.find(s => s.name === item.value) ?? null
        if (selectedSecret) {
          showInput(provider, selectedSecret)
        }
      }
      list.onCancel = showProviders
      tui.addChild(list)
      tui.setFocus(list)
    }

    const showInput = (provider: ProviderSecrets, secret: SecretDecl) => {
      for (const c of [...tui.children]) {
        tui.removeChild(c)
      }
      const inputHeader: Component = {
        render: () => [
          '',
          `\x1B[1m${secret.name}\x1B[0m — ${secret.description}`,
          secret.required ? '\x1B[31m(required)\x1B[0m' : '\x1B[2m(optional)\x1B[0m',
          '',
          'Enter value (empty to clear):',
        ],
        invalidate: () => {},
      }
      tui.addChild(inputHeader)
      const input = new Input()
      input.setValue(db.get(provider.provider, secret.name) ?? '')
      input.onSubmit = (value) => {
        if (value.trim()) {
          db.set(provider.provider, secret.name, value.trim())
        }
        else {
          db.delete(provider.provider, secret.name)
        }
        showSecrets(provider)
      }
      input.onEscape = () => showSecrets(provider)
      tui.addChild(input)
      tui.setFocus(input)
    }

    // Start
    showProviders()
    tui.start()
  })
}
