import { useState } from 'react'
import { PolicyPanel } from './components/PolicyPanel'
import { TaskView } from './components/TaskView'
import type { Task } from './components/TaskView'

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

// Demo data
const DEMO_SOURCES = ['pii', 'email-body', 'calendar', 'credentials', 'medical', 'financial']
const DEMO_SINKS = ['slack', 'web', 'filesystem', 'clipboard']

export default function App() {
  const [isPolicyOpen, setIsPolicyOpen] = useState(false)
  const [denyRules, setDenyRules] = useState<DenyRule[]>([
    { id: '1', source: 'pii', sink: 'slack' },
    { id: '2', source: 'medical', sink: 'slack' },
    { id: '3', source: 'credentials', sink: 'web' },
  ])
  const [sessionLog, setSessionLog] = useState<Array<{ tool: string; allowed: boolean; reason?: string }>>([])
  const [contextTree, setContextTree] = useState<ContextNode | undefined>(undefined)

  // Main chat input (for starting new tasks)
  const [mainInput, setMainInput] = useState('')

  // Active task (null = no task, show main chat)
  const [activeTask, setActiveTask] = useState<Task | null>(null)

  // Completed task summaries (shown in main chat)
  const [completedTasks, setCompletedTasks] = useState<Array<{ id: string; label: string; summary: string }>>([])

  const handleMainSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!mainInput.trim()) return

    const isEmailQuery = mainInput.toLowerCase().includes('email')

    if (isEmailQuery) {
      // Create a new task for checking emails
      const newTask: Task = {
        id: crypto.randomUUID(),
        label: 'Check emails',
        taints: ['email-body'],
        status: 'active',
        messages: [
          {
            id: crypto.randomUUID(),
            role: 'user',
            content: mainInput,
          },
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: 'Found 3 emails. Pick one to handle:',
          },
        ],
        subtasks: [
          {
            id: 'email-1',
            label: 'Email 1: Medical',
            taints: ['pii', 'medical'],
            status: 'pending',
            messages: [],
            summary: undefined,
          },
          {
            id: 'email-2',
            label: 'Email 2: Financial',
            taints: ['pii', 'financial'],
            status: 'pending',
            messages: [],
            summary: undefined,
          },
          {
            id: 'email-3',
            label: 'Email 3: Newsletter',
            taints: [],
            status: 'pending',
            messages: [],
            summary: undefined,
          },
        ],
      }

      setActiveTask(newTask)
      setSessionLog(prev => [...prev, { tool: 'gmail.list', allowed: true }])
      setContextTree({
        id: 'root',
        label: 'Check emails',
        taints: ['email-body'],
        children: [
          { id: 'email-1', label: 'Email 1', taints: ['pii', 'medical'] },
          { id: 'email-2', label: 'Email 2', taints: ['pii', 'financial'] },
          { id: 'email-3', label: 'Email 3', taints: [] },
        ],
      })
    } else {
      // Simple task without subtasks
      const newTask: Task = {
        id: crypto.randomUUID(),
        label: 'Task',
        taints: [],
        status: 'active',
        messages: [
          {
            id: crypto.randomUUID(),
            role: 'user',
            content: mainInput,
          },
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: 'Let me help you with that.',
            toolCalls: [
              {
                id: crypto.randomUUID(),
                name: 'search',
                args: { query: mainInput },
                result: 'Found results',
                taints: [],
              },
            ],
          },
        ],
      }
      setActiveTask(newTask)
    }

    setMainInput('')
  }

  const handleOpenSubtask = (taskId: string, subtaskId: string) => {
    if (!activeTask) return

    const updateSubtasks = (subtasks: Task[] | undefined): Task[] | undefined => {
      if (!subtasks) return undefined
      return subtasks.map(st => {
        if (st.id === subtaskId) {
          // Open this subtask with initial content
          const emailContent = subtaskId === 'email-1'
            ? 'From: doctor@clinic.com\n\nYour appointment is scheduled for Tuesday at 2:00 PM. Dr. Smith wants to review your blood work results.'
            : subtaskId === 'email-2'
            ? 'From: bank@example.com\n\nYour monthly statement is ready. Balance: $4,532.18'
            : 'From: newsletter@tech.io\n\nThis week in tech: New AI models, React 19, and more.'

          return {
            ...st,
            status: 'active' as const,
            messages: [
              {
                id: crypto.randomUUID(),
                role: 'assistant' as const,
                content: emailContent,
                toolCalls: [{
                  id: crypto.randomUUID(),
                  name: 'gmail.read',
                  args: { id: subtaskId },
                  result: 'Email loaded',
                  taints: st.taints,
                }],
              },
            ],
          }
        }
        return st
      })
    }

    setActiveTask({
      ...activeTask,
      subtasks: updateSubtasks(activeTask.subtasks),
    })

    setSessionLog(prev => [...prev, { tool: `gmail.read (${subtaskId})`, allowed: true }])
  }

  const handleSkipSubtask = (taskId: string, subtaskId: string) => {
    if (!activeTask) return

    const updateSubtasks = (subtasks: Task[] | undefined): Task[] | undefined => {
      if (!subtasks) return undefined
      return subtasks.map(st =>
        st.id === subtaskId ? { ...st, status: 'skipped' as const, summary: 'Skipped' } : st
      )
    }

    setActiveTask({
      ...activeTask,
      subtasks: updateSubtasks(activeTask.subtasks),
    })
  }

  const handleCompleteTask = (taskId: string) => {
    if (!activeTask) return

    // Check if completing a subtask
    const subtask = activeTask.subtasks?.find(st => st.id === taskId)
    if (subtask) {
      // Complete the subtask
      const lastMessage = subtask.messages[subtask.messages.length - 1]
      const summary = lastMessage?.role === 'assistant' ? lastMessage.content.slice(0, 50) + '...' : 'Done'

      const updateSubtasks = (subtasks: Task[] | undefined): Task[] | undefined => {
        if (!subtasks) return undefined
        return subtasks.map(st =>
          st.id === taskId ? { ...st, status: 'completed' as const, summary } : st
        )
      }

      setActiveTask({
        ...activeTask,
        subtasks: updateSubtasks(activeTask.subtasks),
      })
      return
    }

    // Completing the main task
    const allSubtasksDone = activeTask.subtasks?.every(
      st => st.status === 'completed' || st.status === 'skipped'
    ) ?? true

    if (!allSubtasksDone) {
      // Add a message asking to complete subtasks first
      setActiveTask({
        ...activeTask,
        messages: [
          ...activeTask.messages,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: 'Please handle or skip all items before completing this task.',
          },
        ],
      })
      return
    }

    // Generate summary from completed subtasks
    const summaries = activeTask.subtasks
      ?.filter(st => st.status === 'completed')
      .map(st => st.summary)
      .join('; ') || 'Task completed'

    setCompletedTasks(prev => [
      ...prev,
      { id: activeTask.id, label: activeTask.label, summary: summaries },
    ])
    setActiveTask(null)
    setContextTree(undefined)
  }

  const handleSendMessage = (taskId: string, content: string) => {
    if (!activeTask) return

    // Find if this is a subtask message
    const subtask = activeTask.subtasks?.find(st => st.id === taskId && st.status === 'active')

    if (subtask) {
      // Message in subtask
      const userMessage = {
        id: crypto.randomUUID(),
        role: 'user' as const,
        content,
      }

      // Demo response based on content
      let responseContent = 'I can help with that.'
      let toolCalls = undefined

      if (content.toLowerCase().includes('calendar') || content.toLowerCase().includes('add')) {
        responseContent = 'Added to your calendar.'
        toolCalls = [{
          id: crypto.randomUUID(),
          name: 'calendar.create',
          args: { title: 'Appointment', date: 'Tuesday 2pm' },
          result: 'Event created',
          taints: [],
        }]
        setSessionLog(prev => [...prev, { tool: 'calendar.create', allowed: true }])
      } else if (content.toLowerCase().includes('slack') || content.toLowerCase().includes('post')) {
        // Check if blocked by policy
        if (subtask.taints.includes('medical') || subtask.taints.includes('pii')) {
          responseContent = 'Cannot post to Slack - blocked by policy.'
          toolCalls = [{
            id: crypto.randomUUID(),
            name: 'slack.post',
            blocked: true,
            blockReason: `${subtask.taints[0]} → slack denied`,
            taints: subtask.taints,
          }]
          setSessionLog(prev => [...prev, { tool: 'slack.post', allowed: false, reason: `${subtask.taints[0]}→slack` }])
        }
      } else if (content.toLowerCase().includes('reply')) {
        responseContent = 'Draft reply created.'
        toolCalls = [{
          id: crypto.randomUUID(),
          name: 'gmail.draft',
          args: { to: 'sender', body: '...' },
          result: 'Draft saved',
          taints: subtask.taints,
        }]
        setSessionLog(prev => [...prev, { tool: 'gmail.draft', allowed: true }])
      }

      const assistantMessage = {
        id: crypto.randomUUID(),
        role: 'assistant' as const,
        content: responseContent,
        toolCalls,
      }

      const updateSubtasks = (subtasks: Task[] | undefined): Task[] | undefined => {
        if (!subtasks) return undefined
        return subtasks.map(st =>
          st.id === taskId
            ? { ...st, messages: [...st.messages, userMessage, assistantMessage] }
            : st
        )
      }

      setActiveTask({
        ...activeTask,
        subtasks: updateSubtasks(activeTask.subtasks),
      })
    } else if (taskId === activeTask.id) {
      // Message in main task
      const userMessage = {
        id: crypto.randomUUID(),
        role: 'user' as const,
        content,
      }

      // Demo: if user mentions a specific email, open it
      let responseContent = 'What would you like to do?'
      const mentionsEmail1 = content.toLowerCase().includes('doctor') || content.toLowerCase().includes('medical') || content.toLowerCase().includes('first')
      const mentionsEmail2 = content.toLowerCase().includes('bank') || content.toLowerCase().includes('financial') || content.toLowerCase().includes('second')
      const mentionsEmail3 = content.toLowerCase().includes('newsletter') || content.toLowerCase().includes('tech') || content.toLowerCase().includes('third')

      if (mentionsEmail1 && activeTask.subtasks?.find(st => st.id === 'email-1' && st.status === 'pending')) {
        responseContent = 'Opening the medical email...'
        setTimeout(() => handleOpenSubtask(activeTask.id, 'email-1'), 100)
      } else if (mentionsEmail2 && activeTask.subtasks?.find(st => st.id === 'email-2' && st.status === 'pending')) {
        responseContent = 'Opening the financial email...'
        setTimeout(() => handleOpenSubtask(activeTask.id, 'email-2'), 100)
      } else if (mentionsEmail3 && activeTask.subtasks?.find(st => st.id === 'email-3' && st.status === 'pending')) {
        responseContent = 'Opening the newsletter...'
        setTimeout(() => handleOpenSubtask(activeTask.id, 'email-3'), 100)
      }

      const assistantMessage = {
        id: crypto.randomUUID(),
        role: 'assistant' as const,
        content: responseContent,
      }

      setActiveTask({
        ...activeTask,
        messages: [...activeTask.messages, userMessage, assistantMessage],
      })
    }
  }

  const handleAddRule = (source: string, sink: string) => {
    setDenyRules(prev => [...prev, { id: crypto.randomUUID(), source, sink }])
  }

  const handleRemoveRule = (id: string) => {
    setDenyRules(prev => prev.filter(r => r.id !== id))
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-neutral-800 bg-neutral-900">
        <div className="flex items-center gap-2">
          <object type="image/svg+xml" data="./logo-x-pulse.svg" className="w-8 h-8" />
          <h1 className="text-sm font-semibold text-neutral-200">ExoAgent</h1>
        </div>
        <button
          onClick={() => setIsPolicyOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors"
        >
          <span>🛡️</span>
          <span>Policy</span>
          {denyRules.length > 0 && (
            <span className="px-1.5 py-0.5 text-xs bg-red-600 rounded-full">
              {denyRules.length}
            </span>
          )}
        </button>
      </header>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Completed tasks */}
        {completedTasks.map(task => (
          <div key={task.id} className="mb-4 px-4 py-3 bg-neutral-800/50 border border-neutral-700 rounded-lg">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-green-500">✓</span>
              <span className="font-medium text-neutral-200">{task.label}</span>
            </div>
            <p className="text-sm text-neutral-400 mt-1">{task.summary}</p>
          </div>
        ))}

        {/* Active task */}
        {activeTask ? (
          <TaskView
            task={activeTask}
            isRoot={true}
            onOpenSubtask={handleOpenSubtask}
            onSkipSubtask={handleSkipSubtask}
            onCompleteTask={handleCompleteTask}
            onSendMessage={handleSendMessage}
          />
        ) : (
          /* Empty state / main input */
          <div className="flex flex-col items-center justify-center h-full text-neutral-500 gap-2">
            <p>Start a task...</p>
            <p className="text-xs text-neutral-600">Try: "Check my emails"</p>
          </div>
        )}
      </div>

      {/* Main input - only when no active task */}
      {!activeTask && (
        <form onSubmit={handleMainSubmit} className="flex gap-2 p-4 border-t border-neutral-800">
          <input
            type="text"
            value={mainInput}
            onChange={e => setMainInput(e.target.value)}
            placeholder="Start a new task..."
            className="flex-1 px-4 py-3 bg-neutral-900 border border-neutral-700 rounded-lg text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-neutral-500"
          />
          <button
            type="submit"
            className="px-6 py-3 bg-neutral-700 hover:bg-neutral-600 text-white rounded-lg transition-colors"
          >
            Start
          </button>
        </form>
      )}

      {/* Policy Panel */}
      <PolicyPanel
        isOpen={isPolicyOpen}
        onClose={() => setIsPolicyOpen(false)}
        sources={DEMO_SOURCES}
        sinks={DEMO_SINKS}
        denyRules={denyRules}
        onAddRule={handleAddRule}
        onRemoveRule={handleRemoveRule}
        sessionLog={sessionLog}
        contextTree={contextTree}
      />
    </div>
  )
}
