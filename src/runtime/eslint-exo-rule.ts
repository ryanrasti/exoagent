/**
 * Custom eslint rule for exo files (src/runtime/exos/).
 *
 * Flags any AST node type not in exoeval's whitelist. Single source of
 * truth — imports from src/exoeval/allowed.ts.
 */

import type { Rule } from 'eslint'
// @ts-expect-error eslint's jiti loader needs .ts extension
import { allowedExpressions, allowedStatements } from '../exoeval/allowed.ts'

const allowedExpressionsSet = new Set<string>(allowedExpressions)
const allowedStatementsSet = new Set<string>(allowedStatements)

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Restrict syntax in exo files to what exoeval supports',
    },
    messages: {
      disallowedExpression: 'Expression type "{{type}}" is not allowed in exos. exoeval only supports: {{allowed}}.',
      disallowedStatement: 'Statement type "{{type}}" is not allowed in exos. exoeval only supports: {{allowed}}.',
      disallowedModuleDeclaration: 'Module declaration "{{type}}" is not allowed in exos. Only `export default` is allowed.',
      constOnly: 'Only `const` declarations are allowed in exos. `{{kind}}` is not supported.',
    },
    schema: [],
  },

  create(context) {
    return {
      // Check all expression nodes
      ':expression': function (node: any) {
        // Skip TypeScript type nodes — erased at runtime
        if (node.type.startsWith('TS')) {
          return
        }
        if (!allowedExpressionsSet.has(node.type)) {
          context.report({
            node,
            messageId: 'disallowedExpression',
            data: {
              type: node.type,
              allowed: allowedExpressions.join(', '),
            },
          })
        }
      },

      // Check all statement nodes
      ':statement': function (node: any) {
        // Skip TypeScript type nodes — erased at runtime
        if (node.type.startsWith('TS')) {
          return
        }
        // Skip module declarations — handled separately
        if (node.type.endsWith('Declaration') && node.type.startsWith('Export')) {
          return
        }
        if (node.type === 'ImportDeclaration') {
          return
        }
        if (!allowedStatementsSet.has(node.type)) {
          context.report({
            node,
            messageId: 'disallowedStatement',
            data: {
              type: node.type,
              allowed: allowedStatements.join(', '),
            },
          })
        }
      },

      // Check module declarations (import/export)
      ImportDeclaration(node: any) {
        // Allow `import type` — it's erased at runtime
        if (node.importKind === 'type') {
          return
        }
        context.report({
          node,
          messageId: 'disallowedModuleDeclaration',
          data: { type: 'ImportDeclaration' },
        })
      },

      ExportNamedDeclaration(node: any) {
        context.report({
          node,
          messageId: 'disallowedModuleDeclaration',
          data: { type: 'ExportNamedDeclaration' },
        })
      },

      ExportAllDeclaration(node: any) {
        context.report({
          node,
          messageId: 'disallowedModuleDeclaration',
          data: { type: 'ExportAllDeclaration' },
        })
      },

      // const-only check
      VariableDeclaration(node: any) {
        if (node.kind !== 'const') {
          context.report({
            node,
            messageId: 'constOnly',
            data: { kind: node.kind },
          })
        }
      },
    }
  },
}

export default rule
