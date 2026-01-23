// @ts-check
import antfu from '@antfu/eslint-config'

export default antfu(
  {
    type: 'lib',
    pnpm: true,
    ignores: [
      '**/dist/**',
      '**/dist-worker/**',
      '**/worker-configuration.d.ts',
      'website/dist/**',
      'website/dist-worker/**',
      'website/worker-configuration.d.ts',
      'website/.wrangler/**',
    ],
  },
  {
    rules: {
      'ts/explicit-function-return-type': 'off',
      'ts/consistent-type-definitions': 'off',
      'antfu/top-level-function': 'off',
      'style/max-statements-per-line': 'off',
      'ts/no-this-alias': 'off',
    },
  },
)
