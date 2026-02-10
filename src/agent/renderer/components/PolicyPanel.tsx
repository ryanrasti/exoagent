import { useState } from 'react'

interface DenyRule {
  id: string
  source: string
  sink: string
}

interface ContextNode {
  id: string
  label: string
  taints: string[]
  children?: ContextNode[]
  toolCalls?: Array<{ tool: string; allowed: boolean; reason?: string }>
}

interface PolicyPanelProps {
  isOpen: boolean
  onClose: () => void
  sources: string[]
  sinks: string[]
  denyRules: DenyRule[]
  onAddRule: (source: string, sink: string) => void
  onRemoveRule: (id: string) => void
  sessionLog: Array<{ tool: string; allowed: boolean; reason?: string }>
  contextTree?: ContextNode
}

function Badge({ type, children }: { type: 'source' | 'sink' | 'blocked'; children: React.ReactNode }) {
  const styles = {
    source: 'bg-cyan-950 text-cyan-400 border-cyan-800',
    sink: 'bg-amber-950 text-amber-400 border-amber-800',
    blocked: 'bg-red-950 text-red-400 border-red-800',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded border ${styles[type]}`}>
      {children}
    </span>
  )
}

function ContextTreeNode({ node, depth = 0 }: { node: ContextNode; depth?: number }) {
  const indent = depth * 12

  return (
    <div style={{ marginLeft: indent }}>
      <div className="flex items-center gap-2 py-1">
        {depth > 0 && <span className="text-neutral-600">├─</span>}
        <span className="text-sm text-neutral-300">{node.label}</span>
        {node.taints.length > 0 && (
          <div className="flex gap-1">
            {node.taints.map(t => (
              <span key={t} className="px-1 py-0.5 text-xs bg-cyan-950 text-cyan-400 border border-cyan-800 rounded">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
      {node.toolCalls?.map((tc, i) => (
        <div
          key={i}
          className={`flex items-center gap-2 text-xs py-0.5 ${
            tc.allowed ? 'text-neutral-500' : 'text-red-400'
          }`}
          style={{ marginLeft: indent + 16 }}
        >
          <span className="text-neutral-600">│</span>
          <span>{tc.allowed ? '✓' : '⛔'}</span>
          <span className="font-mono">{tc.tool}</span>
        </div>
      ))}
      {node.children?.map(child => (
        <ContextTreeNode key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  )
}

export function PolicyPanel({
  isOpen,
  onClose,
  sources,
  sinks,
  denyRules,
  onAddRule,
  onRemoveRule,
  sessionLog,
  contextTree,
}: PolicyPanelProps) {
  const [newSource, setNewSource] = useState('')
  const [newSink, setNewSink] = useState('')

  if (!isOpen) return null

  const handleAddRule = () => {
    if (newSource && newSink) {
      onAddRule(newSource, newSink)
      setNewSource('')
      setNewSink('')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-80 bg-neutral-900 border-l border-neutral-700 h-full overflow-y-auto animate-[slideInRight_0.2s_ease-out]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-700 sticky top-0 bg-neutral-900">
          <div className="flex items-center gap-2">
            <span className="text-lg">🛡️</span>
            <h2 className="font-semibold">Policy</h2>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-200 p-1"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-6">
          {/* Sources */}
          <section>
            <h3 className="text-sm font-medium text-neutral-400 mb-2">Sources</h3>
            <div className="flex flex-wrap gap-2">
              {sources.map(source => (
                <Badge key={source} type="source">{source}</Badge>
              ))}
              {sources.length === 0 && (
                <span className="text-sm text-neutral-500">No sources defined</span>
              )}
            </div>
          </section>

          {/* Sinks */}
          <section>
            <h3 className="text-sm font-medium text-neutral-400 mb-2">Sinks</h3>
            <div className="flex flex-wrap gap-2">
              {sinks.map(sink => (
                <Badge key={sink} type="sink">{sink}</Badge>
              ))}
              {sinks.length === 0 && (
                <span className="text-sm text-neutral-500">No sinks defined</span>
              )}
            </div>
          </section>

          {/* Deny Rules */}
          <section>
            <h3 className="text-sm font-medium text-neutral-400 mb-2">Deny Rules</h3>
            <div className="space-y-2">
              {denyRules.map(rule => (
                <div
                  key={rule.id}
                  className="flex items-center justify-between px-3 py-2 bg-neutral-800 rounded-lg border border-neutral-700"
                >
                  <div className="flex items-center gap-2 text-sm">
                    <Badge type="source">{rule.source}</Badge>
                    <span className="text-red-400">⛔</span>
                    <Badge type="sink">{rule.sink}</Badge>
                  </div>
                  <button
                    onClick={() => onRemoveRule(rule.id)}
                    className="text-neutral-500 hover:text-red-400 text-sm"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {denyRules.length === 0 && (
                <p className="text-sm text-neutral-500">No deny rules</p>
              )}
            </div>

            {/* Add Rule */}
            <div className="mt-3 p-3 bg-neutral-800/50 rounded-lg border border-neutral-700">
              <div className="flex gap-2 mb-2">
                <select
                  value={newSource}
                  onChange={e => setNewSource(e.target.value)}
                  className="flex-1 px-2 py-1.5 bg-neutral-900 border border-neutral-600 rounded text-sm focus:outline-none focus:border-cyan-500"
                >
                  <option value="">Source...</option>
                  {sources.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <span className="text-neutral-500 self-center">→</span>
                <select
                  value={newSink}
                  onChange={e => setNewSink(e.target.value)}
                  className="flex-1 px-2 py-1.5 bg-neutral-900 border border-neutral-600 rounded text-sm focus:outline-none focus:border-amber-500"
                >
                  <option value="">Sink...</option>
                  {sinks.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleAddRule}
                disabled={!newSource || !newSink}
                className="w-full px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:bg-neutral-700 disabled:text-neutral-500 text-sm font-medium rounded transition-colors"
              >
                + Add Deny Rule
              </button>
            </div>
          </section>

          {/* Context Tree */}
          {contextTree && (
            <section>
              <h3 className="text-sm font-medium text-neutral-400 mb-2">Context Tree</h3>
              <div className="bg-neutral-800/50 rounded-lg border border-neutral-700 p-2 overflow-x-auto">
                <ContextTreeNode node={contextTree} />
              </div>
            </section>
          )}

          {/* Session Log */}
          <section>
            <h3 className="text-sm font-medium text-neutral-400 mb-2">Session Log</h3>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {sessionLog.map((entry, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-2 text-sm px-2 py-1 rounded ${
                    entry.allowed ? 'text-neutral-400' : 'text-red-400 bg-red-950/30'
                  }`}
                >
                  <span>{entry.allowed ? '✓' : '⛔'}</span>
                  <span className="font-mono text-xs">{entry.tool}</span>
                  {entry.reason && (
                    <span className="text-xs text-neutral-500">({entry.reason})</span>
                  )}
                </div>
              ))}
              {sessionLog.length === 0 && (
                <p className="text-sm text-neutral-500">No activity yet</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
