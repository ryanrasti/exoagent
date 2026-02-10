import { useState } from 'react'

interface ToolCallProps {
  name: string
  args?: Record<string, unknown>
  result?: string
  taints?: string[]
  blocked?: boolean
  blockReason?: string
}

function Badge({ type, children }: { type: 'source' | 'sink' | 'blocked'; children: React.ReactNode }) {
  const styles = {
    source: 'bg-cyan-950 text-cyan-400 border-cyan-800',
    sink: 'bg-amber-950 text-amber-400 border-amber-800',
    blocked: 'bg-red-950 text-red-400 border-red-800',
  }
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 text-xs font-medium rounded border ${styles[type]}`}>
      {children}
    </span>
  )
}

export function ToolCall({ name, args, result, taints, blocked, blockReason }: ToolCallProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      className={`border rounded-lg overflow-hidden my-2 transition-colors ${
        blocked
          ? 'border-red-500 bg-red-950/20 animate-shake'
          : 'border-neutral-700'
      }`}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 bg-neutral-900 hover:bg-neutral-800 text-sm text-left transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-neutral-500">{expanded ? '▼' : '▶'}</span>
          <span className="font-mono text-neutral-200">{name}</span>
          {blocked && <Badge type="blocked">BLOCKED</Badge>}
        </div>
        <div className="flex items-center gap-1">
          {taints?.map(taint => (
            <Badge key={taint} type="source">{taint}</Badge>
          ))}
        </div>
      </button>

      {/* Body */}
      {expanded && (
        <div className="px-3 py-2 text-sm bg-neutral-950 border-t border-neutral-800">
          {args && (
            <div className="mb-2">
              <span className="text-neutral-500">args: </span>
              <code className="text-neutral-400">{JSON.stringify(args, null, 2)}</code>
            </div>
          )}
          {blocked && blockReason && (
            <div className="text-red-400 flex items-center gap-2">
              <span>⛔</span>
              <span>{blockReason}</span>
            </div>
          )}
          {!blocked && result && (
            <div>
              <span className="text-neutral-500">result: </span>
              <code className="text-green-400">{result}</code>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
