/**
 * Exoeval sandbox types for exos. With noLib: true, this is everything
 * TypeScript knows about.
 */

// TS compiler internals
interface CallableFunction {}
interface Function {}
interface IArguments {}
interface NewableFunction {}
interface RegExp {}
interface Object {}
interface Symbol {}

// Primitives — extends requires a named type alias
type _Array<T> = import('../../exoeval/lib/types').IExoArray<T>
type _String = import('../../exoeval/lib/types').IExoString
type _Number = import('../../exoeval/lib/types').IExoNumber
type _Boolean = import('../../exoeval/lib/types').IExoBoolean

interface Array<T> extends _Array<T> {}
interface String extends _String {}
interface Number extends _Number {}
interface Boolean extends _Boolean {}

// Utility types
interface IterableIterator<T> {}
interface ArrayLike<T> { readonly length: number, readonly [n: number]: T }
interface Promise<T> {}
type Record<K extends string | number | symbol, V> = { [P in K]: V }

// Global values
declare const JSON: import('../../exoeval/lib/types').IExoJSON
declare const Math: import('../../exoeval/lib/types').IExoMath
declare const Object: import('../../exoeval/lib/types').IExoObject
declare const Promise: import('../../exoeval/lib/types').IExoPromise
declare const Date: { new(): import('../../exoeval/lib/types').IExoDate, new(value: string | number): import('../../exoeval/lib/types').IExoDate, now: () => number, parse: (s: string) => number }
