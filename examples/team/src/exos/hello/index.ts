/**
 * Hello exo — minimal test harness.
 * Creates a pi agent session and leaves it running for UI attach.
 */

import type { BoundEval } from 'exoagent/bound-eval'
import type { PiProviderImpl } from 'exoagent/providers/pi'

type HelloCaps = {
	pi: PiProviderImpl
}

export default async ({ exoEval }: { exoEval: BoundEval<HelloCaps> }) => {
	console.log('[hello] creating agent session...')
	const result = await exoEval(({ pi }) => pi.create('hello', 'default'))
	console.log('[hello] agent ready:', result)
}
