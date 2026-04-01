/**
 * Hello exo — minimal test harness.
 * Creates a pi agent with github caps and leaves it running for UI attach.
 */

import type { BoundEval } from 'exoagent/bound-eval'
import type { PiProviderImpl } from 'exoagent/providers/pi'

type HelloCaps = {
	pi: PiProviderImpl
}

export default async ({ exoEval }: { exoEval: BoundEval<HelloCaps> }) => {
	console.log('[hello] creating agent session with github caps...')
	const result = await exoEval.run(
		({ pi }) => pi.create('hello', 'default', capNames),
		{ capNames: ['github'] },
	)
	console.log('[hello] agent ready:', result)
}
