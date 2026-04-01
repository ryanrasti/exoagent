/**
 * Uniform provider init argument.
 * Every provider factory receives this single object.
 */

import { BoundEval } from './bound-eval'
import type { DaemonConfig } from './loader'

export type ProviderInit<Caps = unknown> = {
	exoEval: BoundEval<Caps>
	ring0: unknown
	config: DaemonConfig
}
