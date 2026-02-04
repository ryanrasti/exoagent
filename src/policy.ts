export class Tracked<T, Taint extends string = string> {
  constructor(
    public readonly value: T,
    public readonly taints?: Taint[],
  ) {}

  getTaints(): Taint[] {
    return this.taints ?? []
  }
}

export const wrapTracked = <T, Taint extends string = string>(value: T, taints?: Taint[]): Tracked<T, Taint> =>
  new Tracked(value, taints)

/** Returns taint sources for Tracked values; non-Tracked is treated as no taints (empty array). */
export const getTaints = <T extends string>(x: unknown): T[] =>
  x instanceof Tracked ? x.getTaints() : []

const unwrapOne = <T>(x: T | Tracked<T>): { value: T, wrapped: boolean, taints: string[] } =>
  x instanceof Tracked
    ? { value: x.value, wrapped: true, taints: x.getTaints() }
    : { value: x as T, wrapped: false, taints: [] }

export const unwrapThisAndArgs = (
  thisVal: unknown,
  args: unknown[],
): { thisVal: unknown, args: unknown[], anyWrapped: boolean, taints: string[] } => {
  const t = unwrapOne(thisVal)
  let anyWrapped = t.wrapped
  const taints: string[] = [...t.taints]
  const argsUnwrapped = args.map((a) => {
    const u = unwrapOne(a)
    if (u.wrapped)
      anyWrapped = true
    taints.push(...u.taints)
    return u.value
  })
  return { thisVal: t.value, args: argsUnwrapped, anyWrapped, taints }
}

export type Rule<Source extends string = string, Sink extends string = string> = { source?: Source, sink?: Sink }

export type ToolProps<Sink extends string = string> = { sink?: Sink }
