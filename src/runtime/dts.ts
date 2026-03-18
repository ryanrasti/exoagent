import * as ts from 'typescript'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/**
 * Generate a .d.ts declaration string from a TypeScript source file.
 *
 * Uses the TypeScript compiler API to emit declarations. Resolves imports
 * so the output includes full type information.
 *
 * @param filePath - Absolute path to the .ts source file
 * @param filter - Optional filter on which declarations to include (e.g. only exported classes)
 * @returns The generated .d.ts content
 */
export function generateDts(filePath: string): string {
  const absPath = resolve(filePath)

  // Find the nearest tsconfig.json for compiler options
  const configPath = ts.findConfigFile(dirname(absPath), ts.sys.fileExists, 'tsconfig.json')
  let compilerOptions: ts.CompilerOptions = {
    declaration: true,
    emitDeclarationOnly: true,
    strict: true,
    esModuleInterop: true,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
  }

  if (configPath) {
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
    if (!configFile.error) {
      const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, dirname(configPath))
      // Merge project options but force declaration emit
      compilerOptions = {
        ...parsed.options,
        declaration: true,
        emitDeclarationOnly: true,
        noEmit: false,
      }
    }
  }

  const program = ts.createProgram([absPath], compilerOptions)
  const sourceFile = program.getSourceFile(absPath)
  if (!sourceFile) {
    throw new Error(`Could not load source file: ${absPath}`)
  }

  // Check for fatal diagnostics
  const diagnostics = ts.getPreEmitDiagnostics(program, sourceFile)
  const errors = diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error)
  if (errors.length > 0) {
    const msgs = errors.slice(0, 5).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
    throw new Error(`TypeScript errors in ${absPath}:\n${msgs.join('\n')}`)
  }

  let dts = ''
  const result = program.emit(sourceFile, (fileName, text) => {
    if (fileName.endsWith('.d.ts')) {
      dts += text
    }
  }, undefined, true /* emitOnlyDtsFiles */)

  if (result.diagnostics.length > 0) {
    const msgs = result.diagnostics.slice(0, 5).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
    throw new Error(`Emit errors for ${absPath}:\n${msgs.join('\n')}`)
  }

  if (!dts) {
    throw new Error(`No declarations generated for: ${absPath}`)
  }

  return dts
}

/**
 * Generate a .d.ts for a class, extracting only its public method signatures.
 *
 * This produces a minimal type declaration suitable for codemode — just the
 * methods the LLM can call, without internal implementation details.
 *
 * @param filePath - Absolute path to the .ts source file
 * @param className - Name of the class to extract
 * @returns A declaration string like `{ method(args): ReturnType; ... }`
 */
export function generateCapDts(filePath: string, className: string): string {
  const fullDts = generateDts(filePath)

  // Parse the generated .d.ts to extract the class
  const sourceFile = ts.createSourceFile('cap.d.ts', fullDts, ts.ScriptTarget.Latest, true)

  const methods: string[] = []

  function visit(node: ts.Node) {
    if (ts.isClassDeclaration(node) && node.name?.text === className) {
      for (const member of node.members) {
        if (!ts.isMethodDeclaration(member)) {
          continue
        }
        // Skip private/protected
        if (member.modifiers?.some(m =>
          m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword)) {
          continue
        }
        // Get the method text from the .d.ts
        const methodText = fullDts.slice(member.pos, member.end).trim()
        if (methodText) {
          methods.push(`  ${methodText}`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  if (methods.length === 0) {
    throw new Error(`No public methods found for class ${className} in ${filePath}`)
  }

  return `{\n${methods.join('\n')}\n}`
}
