import ts from 'typescript'

/**
 * Convert TypeScript source code to declaration (.d.ts) format.
 * Strips implementation details and produces clean type definitions.
 */
export function tsToDts(source: string): string {
  const fileName = 'input.ts'
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)

  let dts = ''
  const host: ts.CompilerHost = {
    getSourceFile: (name) => (name === fileName ? sourceFile : undefined),
    getDefaultLibFileName: () => 'lib.d.ts',
    writeFile: (name, text) => {
      if (name.endsWith('.d.ts')) dts = text
    },
    getCurrentDirectory: () => '/',
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (f) => f === fileName,
    readFile: () => undefined,
  }

  const program = ts.createProgram(
    [fileName],
    {
      declaration: true,
      emitDeclarationOnly: true,
    },
    host,
  )

  program.emit()
  return dts
}
