import { useState } from 'react'

interface ToolCallData {
  id: string
  name: string
  args?: Record<string, unknown>
  result?: string
  taints?: string[]
  blocked?: boolean
  blockReason?: string
}

interface TaskMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCallData[]
}

interface Task {
  id: string
  label: string
  taints: string[]
  status: 'pending' | 'active' | 'completed' | 'skipped'
  messages: TaskMessage[]
  subtasks?: Task[]
  summary?: string // clean output when completed
}

interface TaskViewProps {
  task: Task
  isRoot?: boolean
  onOpenSubtask: (taskId: string, subtaskId: string) => void
  onSkipSubtask: (taskId: string, subtaskId: string) => void
  onCompleteTask: (taskId: string) => void
  onSendMessage: (taskId: string, content: string) => void
  depth?: number
}

function Badge({ children, variant = 'taint' }: { children: React.ReactNode; variant?: 'taint' | 'status' }) {
  const styles = {
    taint: 'bg-cyan-950 text-cyan-400 border-cyan-800',
    status: 'bg-neutral-800 text-neutral-400 border-neutral-700',
  }
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 text-xs font-medium rounded border ${styles[variant]}`}>
      {children}
    </span>
  )
}

function ToolCallDisplay({ tc }: { tc: ToolCallData }) {
  return (
    <div className={`flex items-center gap-2 text-xs py-1 px-2 rounded ${
      tc.blocked ? 'bg-red-950/30 text-red-400' : 'bg-neutral-800/50 text-neutral-400'
    }`}>
      <span className="font-mono">{tc.blocked ? '⛔' : '✓'} {tc.name}</span>
      {tc.blocked && tc.blockReason && (
        <span className="text-red-500">({tc.blockReason})</span>
      )}
      {tc.taints?.map(t => (
        <span key={t} className="px-1 py-0.5 bg-cyan-950/50 text-cyan-500 rounded text-[10px]">
          {t}
        </span>
      ))}
    </div>
  )
}

export function TaskView({
  task,
  isRoot = false,
  onOpenSubtask,
  onSkipSubtask,
  onCompleteTask,
  onSendMessage,
  depth = 0,
}: TaskViewProps) {
  const [input, setInput] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return
    onSendMessage(task.id, input)
    setInput('')
  }

  const activeSubtask = task.subtasks?.find(st => st.status === 'active')
  const pendingSubtasks = task.subtasks?.filter(st => st.status === 'pending') ?? []
  const completedSubtasks = task.subtasks?.filter(st => st.status === 'completed' || st.status === 'skipped') ?? []

  // If there's an active subtask, show it
  if (activeSubtask) {
    return (
      <div className={`border rounded-lg overflow-hidden ${
        depth === 0 ? 'border-neutral-700 bg-neutral-900' : 'border-cyan-800/50 bg-cyan-950/20'
      }`}>
        {/* Task header */}
        <div className="flex items-center justify-between px-4 py-2 bg-neutral-800/50 border-b border-neutral-700">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-neutral-200">{task.label}</span>
            {task.taints.map(t => (
              <Badge key={t}>{t}</Badge>
            ))}
          </div>
        </div>

        {/* Active subtask */}
        <div className="p-3">
          <TaskView
            task={activeSubtask}
            onOpenSubtask={onOpenSubtask}
            onSkipSubtask={onSkipSubtask}
            onCompleteTask={onCompleteTask}
            onSendMessage={onSendMessage}
            depth={depth + 1}
          />
        </div>

        {/* Completed subtasks summaries */}
        {completedSubtasks.length > 0 && (
          <div className="px-4 py-2 border-t border-neutral-700 bg-neutral-900/50">
            <p className="text-xs text-neutral-500 mb-1">Completed:</p>
            {completedSubtasks.map(st => (
              <div key={st.id} className="flex items-center gap-2 text-sm text-neutral-400">
                <span className="text-green-500">✓</span>
                <span>{st.label}:</span>
                <span className="text-neutral-300">{st.summary || 'Done'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // No active subtask - show task content
  return (
    <div className={`border rounded-lg overflow-hidden ${
      depth === 0 ? 'border-neutral-700 bg-neutral-900' : 'border-cyan-800/50 bg-cyan-950/20'
    }`}>
      {/* Task header */}
      <div className={`flex items-center justify-between px-4 py-2 border-b ${
        depth === 0 ? 'bg-neutral-800/50 border-neutral-700' : 'bg-cyan-900/20 border-cyan-800/30'
      }`}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-neutral-200">{task.label}</span>
          {task.taints.map(t => (
            <Badge key={t}>{t}</Badge>
          ))}
        </div>
        {task.status === 'active' && (
          <Badge variant="status">active</Badge>
        )}
      </div>

      {/* Messages */}
      <div className="p-3 space-y-3 max-h-64 overflow-y-auto">
        {task.messages.map(msg => (
          <div key={msg.id} className={`${msg.role === 'user' ? 'text-right' : ''}`}>
            <div className={`inline-block px-3 py-2 rounded-lg text-sm ${
              msg.role === 'user'
                ? 'bg-neutral-700 text-neutral-100'
                : 'bg-neutral-800/50 text-neutral-300'
            }`}>
              <p>{msg.content}</p>
              {msg.toolCalls?.map(tc => (
                <ToolCallDisplay key={tc.id} tc={tc} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Pending subtasks */}
      {pendingSubtasks.length > 0 && (
        <div className="px-3 pb-3 space-y-2">
          {pendingSubtasks.map(subtask => (
            <div
              key={subtask.id}
              className="flex items-center justify-between px-3 py-2 bg-neutral-800/30 border border-neutral-700 rounded-lg"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm text-neutral-300">{subtask.label}</span>
                {subtask.taints.map(t => (
                  <Badge key={t}>{t}</Badge>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onOpenSubtask(task.id, subtask.id)}
                  className="px-2 py-1 text-xs bg-cyan-800 hover:bg-cyan-700 text-cyan-100 rounded transition-colors"
                >
                  Open
                </button>
                <button
                  onClick={() => onSkipSubtask(task.id, subtask.id)}
                  className="px-2 py-1 text-xs bg-neutral-700 hover:bg-neutral-600 text-neutral-300 rounded transition-colors"
                >
                  Skip
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Completed subtasks summaries */}
      {completedSubtasks.length > 0 && (
        <div className="px-3 pb-3">
          <p className="text-xs text-neutral-500 mb-1">Completed:</p>
          {completedSubtasks.map(st => (
            <div key={st.id} className="flex items-center gap-2 text-sm text-neutral-400 py-0.5">
              <span className={st.status === 'completed' ? 'text-green-500' : 'text-neutral-500'}>
                {st.status === 'completed' ? '✓' : '○'}
              </span>
              <span>{st.label}:</span>
              <span className="text-neutral-300">{st.summary || (st.status === 'skipped' ? 'Skipped' : 'Done')}</span>
            </div>
          ))}
        </div>
      )}

      {/* Input area - only for active tasks */}
      {task.status === 'active' && (
        <div className="border-t border-neutral-700">
          <form onSubmit={handleSubmit} className="flex gap-2 p-3">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 px-3 py-2 text-sm bg-neutral-800 border border-neutral-600 rounded text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-neutral-500"
            />
            <button
              type="submit"
              className="px-4 py-2 text-sm bg-neutral-700 hover:bg-neutral-600 text-white rounded transition-colors"
            >
              Send
            </button>
          </form>

          {/* Complete task button */}
          <div className="px-3 pb-3">
            <button
              onClick={() => onCompleteTask(task.id)}
              className="w-full px-3 py-2 text-sm bg-green-800 hover:bg-green-700 text-green-100 rounded transition-colors"
            >
              ✓ Complete {isRoot ? 'Task' : 'Subtask'}
            </button>
          </div>
        </div>
      )}

      {/* Completed task shows summary */}
      {task.status === 'completed' && task.summary && (
        <div className="px-3 py-2 border-t border-neutral-700 bg-green-950/20">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-green-500">↩</span>
            <span className="text-neutral-400">Result:</span>
            <span className="text-neutral-200">{task.summary}</span>
          </div>
        </div>
      )}
    </div>
  )
}

export type { Task, TaskMessage, ToolCallData }
