# Cap'n Web Eval

A companion to Cap'n Web, with two basic utilities:
- `safeEval(expr: string, globalThis: RpcStub)` - evaluate a subset of JS that essentially maps 1:1 with the Cap'n Web wire format.
    * The subset specifically supports:
        * Literal values: `boolean`, `string`, `number`, `bigint`, `object` (only string keys), `Array`
        * Identifiers: `foo`
        * Member access: `foo.bar`
        * Function invocation: `bar(baz)`
        * Variable assignement (`const` only): `const a = ...`
        * Functions (`=>` functions only): `(a, b, c) => ...`
        * Block statements `{ a; b; c; }`
    * Notably it intentionally **does not** support:
        * Standard library methods (e.g., on `string`/`number`/`array`)
        * Operators for local computation: `+`, `/`, ...
        * Control flow operators: `if`, `while`, `try`, `catch`, ...
        * `async` / `await`

# Roadmap

[ ] Devaluate: `deval(instructions: unknown[]): string` - convert Cap'n Web wire format instructions back to JS (that would be `safeEval`-able). This is envisionsed to primarily be a debugging utility.
[ ] Computation limits for `safeEval` (specifically limiting number of steps and recursion depth)
