import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
	test: {
		exclude: ['**/node_modules/**', '**/.direnv/**'],
		poolOptions: {
			workers: {
				wrangler: { configPath: './wrangler.jsonc' },
				isolatedStorage: false,
			},
		},
	},
})
