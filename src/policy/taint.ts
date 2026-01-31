import { RpcPromise, RpcStub, RpcTarget } from "capnweb"

export class Policy<Source extends string[], Sink extends string[]> {
    #sources: Set<Source>
    #sinks: Set<Sink>
    
    constructor(sources: Source[], sinks: Sink[]) {
        this.#sources = new Set(sources)
        this.#sinks = new Set(sinks)
    }

}


const taintedProperty = Symbol('taintedProperty')
const isStub = (value: unknown): value is RpcStub<{}> => {
    return value instanceof RpcStub
}

class TaintedValue<T> extends RpcTarget {
    constructor(value: T, taints: Set<string>) {
        super()
        if (value instanceof TaintedValue) {
            return value
        }
        const wrap = (value: T, newTaints = taints) => new TaintedValue(value, taints)
        const has = (_target: this, prop: string | symbol) => {
            if (prop === taintedProperty) {
                return true
            }
            if (Array.isArray(value) || typeof value === 'string') {
                return typeof prop === 'number'
            }
            if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
                return Object.hasOwn(value, prop)
            }
            if (isStub(value)) {
                return prop in value
            }
            return false
        }

        return new Proxy(this, {
            apply: (target, thisArg, args) => {
                const unionTaints = new Set([...taints, ...args.flatMap(arg => arg[taintedProperty]?.taints ?? [])])

                if (isStub(value)) {
                    // Remote call: wrap the args
                    return wrap(target.apply(thisArg, args.map(arg => wrap(arg, unionTaints))))
                }
                // Local call: wrap the return value
                return wrap(target.apply(thisArg, args), unionTaints)
            },
            get: (_target, prop, _receiver) => {
                if (prop === taintedProperty) {
                    return { value, taints }
                }
                if (value == null) {
                    return wrap(value[prop])
                }
                if (has(_target, prop)) {
                    const raw = value[prop]
                    if (prop === 'then' && typeof raw === 'function') {
                        // TODO: catch errors
                        return () => (async () => wrap(await value))()
                    }
                    // TODO: `catch`/`finally`

                    if (prop in RpcPromise.prototype || typeof prop === 'symbol') {
                        // Pass these through as-is:
                        return raw
                    }

                    return wrap(raw)
                }
                return undefined
            },
            has,
        })
    }

}



// Constraints:
// 1. Local function calls (including record/replay callbacks):
  // a. args are unwrapped
  // b. return value is wrapped
// 2. Remote function calls (stub methods/pass-by reference callbacks):
  // a. args are **wrapped**
  // b. return value is **unwrapped**

// Implication: we need very special handling for callback arguments/return values


// Wrap algo: on return, put in TaintedValue wrapper
// - base case: primitive
// - containers: object, array
//   - on property access, unwrap and wrap again
// - rpcstub/target/rpc-promise
//   - similar to container
//   - may need to be dup`ed
// - special case: function/promise-like
  // - if record/replay, passthrough
  // - otherwise, **return value** is wrapped


// Unwrap algo: check if TaintedValue, if so unwrap, otherwise return value

// edge case:
// - exception -> TaintedError or something

// Open questions:
// 1. How to configure a "taint" mode vs regular mode for RpcToolset?
//    - Issues: a. for local tests, basic configs -> don't want tainting
//                but if tainting is enabled somewhere, then should be impossible to forget to taint somewhere else
//                -> especially troublesome for async code that might keep running after the tool call
//              b. when calling methods, base object needs taintability
//                -> maybe that's the solution! whenever base object is TaintedValue, then all methods do taint tracking
//                -> and that propegates recursively!
// 2. internal vs. external calls:
//    - internal calls: no taint tracking/enforcement (for PoC)
//       - harder to do with above approach (and also unsure if it's desirable)