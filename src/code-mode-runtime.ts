// Runtime template for sandbox execution
// This gets bundled with capnweb and StreamTransport, then injected into safeEval

import type { ToolApi } from './tool'
import { RpcSession } from 'capnweb'
import { StreamTransport } from './stream-transport'

declare const __SANDBOX_CONTEXT_PROMISE__: Promise<{
  input: ReadableStream<Uint8Array>
  output: WritableStream<Uint8Array>
  onSuccess: () => void
  onFailure: () => void
}> | undefined

async function run(context: {
  input: ReadableStream<Uint8Array>
  output: WritableStream<Uint8Array>
}) {
  const transport = new StreamTransport(context.input, context.output)
  try {
    const session = new RpcSession<ToolApi>(transport)
    const api = session.getRemoteMain()

    // The actual runtime code to execute:
    const code = await api.__code__()

    // eslint-disable-next-line no-new-func
    const fn = new Function('api', `return (${code})(api)`)
    // Actually execute the code:
    const result = await fn(api)
    // Return the result to the remote side:
    await api.__return__(result)
  }
  finally {
    // Abort transport to stop RPC read loop and allow process to exit naturally
    transport.abort('done')
  }
}

async function main() {
  if (!__SANDBOX_CONTEXT_PROMISE__) {
    throw new TypeError('__SANDBOX_CONTEXT_PROMISE__ was not replaced prior to execution.')
  }
  const ctx = await __SANDBOX_CONTEXT_PROMISE__
  const { input, output, onSuccess, onFailure } = ctx

  return run({ input, output })
    .then(() => {
      onSuccess()
    })
    .catch((err) => {
      console.error('runtime error', err)
      onFailure()
    })
}

main()
