interface RedactedRefProps {
  displayText: string
  refId: string
  taints: string[]
}

export function RedactedRef({ displayText, refId, taints }: RedactedRefProps) {
  return (
    <span className="inline-flex flex-col mx-1 align-bottom">
      <span className="inline-flex items-center px-2 py-0.5 bg-cyan-950/50 border border-cyan-700 rounded text-cyan-300 font-medium">
        {displayText}
      </span>
      <span className="text-[10px] text-neutral-500 mt-0.5">
        {refId} · {taints.join(', ')}
      </span>
    </span>
  )
}
