import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config([
  globalIgnores([
    'dist',
    'dist/**',
    'dist-worker',
    'dist-worker/**',
    'website/dist/**',
    'website/dist-worker/**',
    '**/dist/**',
    '**/dist-worker/**',
    'worker-configuration.d.ts',
    'website/worker-configuration.d.ts',
    '**/worker-configuration.d.ts',
    '**/*.config.d.ts',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
])
