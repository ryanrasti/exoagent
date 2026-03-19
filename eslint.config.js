// @ts-check
import antfu from '@antfu/eslint-config'
import exoRule from './src/runtime/eslint-exo-rule.ts'

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
      'src/runtime/exos/exoeval.d.ts',
      'src/runtime/exos/lib.d.ts',
      'src/runtime/exos/typecheck.test.ts',
      'AGENTS.md',
    ],
  },
  {
    rules: {
      'ts/explicit-function-return-type': 'off',
      'ts/consistent-type-definitions': 'off',
      'antfu/top-level-function': 'off',
      'style/max-statements-per-line': 'off',
      'ts/no-this-alias': 'off',
      'antfu/no-top-level-await': 'off',
      'test/prefer-lowercase-title': 'off',
      'curly': ['error', 'all'],
      'ts/no-use-before-define': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSImportType',
          message: 'No inline `import()` for types. Use `import type { ... } from "..."` at the top of the file. Inline imports should only appear in .d.ts files.',
        },
      ],
    },
  },
  {
    files: ['src/runtime/start.ts', 'src/runtime/start-agent.ts', 'src/runtime/secrets-ui.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['src/runtime/exos/**/*.ts'],
    ignores: ['src/runtime/exos/**/*.d.ts'],
    plugins: {
      exo: { rules: { 'restricted-syntax': exoRule } },
    },
    rules: {
      'exo/restricted-syntax': 'error',
    },
  },
)
