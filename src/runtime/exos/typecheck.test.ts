/**
 * Type-level tests for exos noLib environment.
 * tsc passing on this file = sandbox types are correct.
 * @ts-expect-error lines verify non-sandbox APIs don't exist.
 */

// Exoeval builtins work
const arr = [1, 2, 3]
const doubled = arr.map(x => x * 2)
const found = arr.find(x => x > 1)
const joined = arr.join(', ')
const str = 'hello'
const upper = str.toUpperCase()
const trimmed = str.trim()
const parts = str.split('l')
const json = JSON.stringify({ arr: doubled, str: upper })
const parsed = JSON.parse(json)
const n = Math.floor(3.5)
const d = new Date()
const iso = d.toISOString()

// Sandbox globals do NOT exist
// @ts-expect-error
setTimeout(() => { }, 100)
// @ts-expect-error
setInterval(() => { }, 100)
// @ts-expect-error
fetch('http://example.com')
// @ts-expect-error
Buffer.from('hello')
// @ts-expect-error
const e = new Error('boom')
// @ts-expect-error
console.log('hello')
// @ts-expect-error
process.exit(1)
// @ts-expect-error
require('node:fs')

// Non exposed methods do NOT exist
// @ts-expect-error
arr.splice(0)

export default async () => { }
