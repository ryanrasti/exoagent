// @ts-check
import antfu from '@antfu/eslint-config'

export default antfu(
	{
		type: 'lib',
		ignores: [
			'**/dist/**',
			'.pnpm-store/**',
			'AGENTS.md',
		],
	},
	{
		rules: {
			'style/indent': ['error', 'tab'],
			'style/no-tabs': 'off',
			'node/prefer-global/process': 'off',
			'no-console': 'off',
			'e18e/prefer-static-regex': 'off',
			'style/jsx-indent-props': 'off',
			'style/indent-binary-ops': 'off',
			'ts/explicit-function-return-type': 'off',
			'ts/consistent-type-definitions': ['error', 'type'],
			'ts/no-this-alias': 'off',
			'antfu/top-level-function': 'off',
			'antfu/no-top-level-await': 'off',
			'style/max-statements-per-line': 'off',
			'test/prefer-lowercase-title': 'off',
			'prefer-arrow-callback': 'error',
			'curly': ['error', 'all'],
			'ts/no-use-before-define': 'off',
			'no-restricted-syntax': [
				'error',
				{
					selector: 'TSImportType',
					message: 'No inline `import()` for types. Use `import type { ... } from "..."` at the top of the file.',
				},
				{
					selector: 'TSInterfaceDeclaration',
					message: 'Prefer `type` over `interface`.',
				},
			],
		},
	},
)
