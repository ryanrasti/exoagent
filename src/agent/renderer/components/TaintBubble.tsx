import { useState } from 'react'
import { ToolCall } from './ToolCall'

interface ToolCallData {
  id: string
  name: string
  args?: Record<string, unknown>
  result?: string
  taints?: string[]
  blocked?: boolean
  blockReason?: string
}

interface TaintBubbleProps {
  id: string
  label: string
  icon?: string
  taints: string[]
  children?: React.ReactNode
  toolCalls?: ToolCallData[]
  summary?: string
  content?: string  // detailed response text inside the bubble
  defaultExpanded?: boolean
  onClick?: () => void  // when user clicks to select this context
  isClickable?: boolean
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

export function TaintBubble({
  label,
  icon = '🔒',
  taints,
  children,
  toolCalls,
  summary,
  content,
  defaultExpanded = false,
  onClick,
  isClickable = false,
}: TaintBubbleProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  const handleHeaderClick = () => {
    setExpanded(!expanded)
  }

  const handleSelectClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onClick?.()
  }

  return (
    <div className={`my-3 border rounded-lg overflow-hidden bg-neutral-900/50 ${
      isClickable ? 'border-cyan-700/50 hover:border-cyan-600' : 'border-neutral-600'
    }`}>
      {/* Header */}
      <button
        onClick={handleHeaderClick}
        className="w-full flex items-center justify-between px-3 py-2 bg-neutral-800/50 hover:bg-neutral-800 text-left transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-neutral-400">{expanded ? '▼' : '▶'}</span>
          <span>{icon}</span>
          <span className="text-sm font-medium text-neutral-200">{label}</span>
        </div>
        <div className="flex items-center gap-1">
          {taints.map(taint => (
            <Badge key={taint} type="source">{taint}</Badge>
          ))}
          {isClickable && (
            <button
              onClick={handleSelectClick}
              className="ml-2 px-2 py-0.5 text-xs bg-cyan-800 hover:bg-cyan-700 text-cyan-100 rounded transition-colors"
            >
              Reply
            </button>
          )}
        </div>
      </button>

      {/* Expanded Content */}
      {expanded && (
        <div className="px-3 py-2 border-t border-neutral-700 bg-neutral-950/50">
          {content && (
            <p className="text-sm text-neutral-300 mb-2">{content}</p>
          )}
          {children}
          {toolCalls?.map(tc => (
            <ToolCall
              key={tc.id}
              name={tc.name}
              args={tc.args}
              result={tc.result}
              taints={tc.taints}
              blocked={tc.blocked}
              blockReason={tc.blockReason}
            />
          ))}
        </div>
      )}

      {/* Summary (always visible) */}
      {summary && (
        <div className="px-3 py-2 border-t border-neutral-700 bg-neutral-900/30">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-green-500">↩</span>
            <span className="text-neutral-400">clean output:</span>
            <span className="text-neutral-200">{summary}</span>
          </div>
        </div>
      )}
    </div>
  )
}
