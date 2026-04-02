/** Log provider — ring0 for pino. */
export default {
	ring0: async () => {
		const pino = (await import('pino')).default
		return {
			pino: pino({
				level: process.env.LOG_LEVEL ?? 'info',
			}) as unknown,
		}
	},
}
