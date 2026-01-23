import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface LayoutProps {
  children: ReactNode
  headerRight?: ReactNode
}

interface SectionProps {
  children: ReactNode
  variant?: 'dark' | 'gray'
  className?: string
}

export function Section({ children, variant = 'dark', className = '' }: SectionProps) {
  const bg = variant === 'gray' ? 'bg-neutral-900/50' : ''
  return (
    <section className={`px-8 py-12 border-t border-neutral-800 ${bg} ${className}`}>
      <div className="max-w-3xl mx-auto">
        {children}
      </div>
    </section>
  )
}

export function Layout({ children, headerRight }: LayoutProps) {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-neutral-800 px-8 py-4 flex justify-between items-center">
        <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
          <img src="/logo-x-pulse.svg" alt="ExoAgent" className="w-8 h-8" />
          <span className="font-bold text-lg">ExoAgent</span>
        </Link>
        {headerRight}
      </header>

      {/* Main content */}
      <main className="flex-1">
        {children}
      </main>

      {/* Footer */}
      <footer className="px-8 py-8 border-t border-neutral-800 text-center text-neutral-500 text-sm">
        <p>ExoAgent — The OS kernel to safely unleash your agents</p>
      </footer>
    </div>
  )
}

const GITHUB_URL = 'https://github.com/ryanrasti/exoagent'

export function GitHubLink({ children }: { children: ReactNode }) {
  return (
    <a
      href={GITHUB_URL}
      className="flex items-center gap-2 px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors"
    >
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
        <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
      </svg>
      <span>{children}</span>
    </a>
  )
}

export { GITHUB_URL }
