import type { SqlResult } from '../worker/index'
import { Highlight, themes } from 'prism-react-renderer'
import { useState } from 'react'
import { z } from 'zod'

const toolCallOutputSchema = z.object({
  results: z.array(z.unknown()).optional(),
  sql: z.string().optional(),
  parameters: z.array(z.unknown()).optional(),
})

export function ToolResult({ toolName, args, result }: { toolName: string, args: unknown, result: unknown }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const outputValidation = toolCallOutputSchema.safeParse(result)
  const isSqlResult = outputValidation.success
  const sqlResult = isSqlResult ? outputValidation.data : null

  // Handle error cases
  if ((result as { error?: string })?.error) {
    return (
      <div className="text-xs bg-neutral-900 rounded p-2 font-mono">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center gap-2 text-left text-neutral-500 hover:text-neutral-400 transition-colors"
        >
          <span className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
          <span>
            →
            {' '}
            {toolName}
            (
            {JSON.stringify(args)}
            )
          </span>
        </button>
        {isExpanded && (
          <div className="mt-2 text-amber-400">
            {JSON.stringify(result, null, 2)}
          </div>
        )}
      </div>
    )
  }

  const resultCount = sqlResult?.results && Array.isArray(sqlResult.results) ? sqlResult.results.length : null

  return (
    <div className="text-xs bg-neutral-900 rounded p-2 font-mono">
      {/* Expandable header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 text-left text-neutral-500 hover:text-neutral-400 transition-colors"
      >
        <span className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
        <span className="flex-1">
          →
          {' '}
          {toolName}
          (
          {JSON.stringify(args)}
          )
        </span>
        {resultCount != null && (
          <span className="text-neutral-600 text-[10px]">
            {resultCount}
            {' '}
            {resultCount === 1 ? 'row' : 'rows'}
          </span>
        )}
      </button>

      {/* Expandable content */}
      {isExpanded && (
        <div className="mt-2 space-y-2">
          {/* Result */}
          {isSqlResult && sqlResult?.sql && (
            <div className="space-y-2">
              {/* SQL with syntax highlighting */}
              <div>
                <div className="text-neutral-500 text-[10px] mb-1">SQL Executed:</div>
                <div className="bg-neutral-950 rounded p-2 overflow-x-auto">
                  <Highlight theme={themes.nightOwl} code={sqlResult.sql} language="sql">
                    {({ style, tokens, getLineProps, getTokenProps }) => (
                      <pre className="text-[10px] m-0" style={{ ...style, background: 'transparent' }}>
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
                </div>
              </div>

              {/* Parameters */}
              {sqlResult.parameters && sqlResult.parameters.length > 0 && (
                <div>
                  <div className="text-neutral-500 text-[10px] mb-1">Parameters:</div>
                  <div className="text-neutral-400 text-[10px]">
                    {JSON.stringify(sqlResult.parameters)}
                  </div>
                </div>
              )}

              {/* Results - one line per row */}
              {sqlResult.results && Array.isArray(sqlResult.results) && (
                <div>
                  <div className="text-neutral-500 text-[10px] mb-1">Results:</div>
                  <div className="space-y-0.5">
                    {sqlResult.results.map((row, i) => (
                      <div key={i} className="text-green-400 text-[10px]">
                        {JSON.stringify(row)}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Fallback for non-SQL results */}
          {!isSqlResult && (
            <div className={`${
              (result as { error?: string })?.error
                ? 'text-amber-400'
                : (result as SqlResult)?.hacked
                    ? 'text-red-500 font-bold animate-pulse'
                    : 'text-green-400'
            }`}
            >
              {JSON.stringify(result, null, 2)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
