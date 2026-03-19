// Format relative time (e.g., "2m ago", "1h ago")
export function formatRelativeTime(dateStr: string): string {
  const then = new Date(dateStr).getTime()
  if (Number.isNaN(then)) { return '—' }

  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000))

  if (diffSec < 60) { return `${diffSec}s ago` }
  if (diffSec < 3600) { return `${Math.floor(diffSec / 60)}m ago` }
  if (diffSec < 86400) { return `${Math.floor(diffSec / 3600)}h ago` }
  return `${Math.floor(diffSec / 86400)}d ago`
}
