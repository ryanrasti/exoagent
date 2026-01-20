import type { RpcSessionOptions, RpcStub, RpcTarget, RpcTransport } from 'capnweb'
import { RpcSession } from 'capnweb'
import { expect } from 'vitest'

class TestTransport implements RpcTransport {
  constructor(public name: string, private partner?: TestTransport) {
    if (partner) {
      partner.partner = this
    }
  }

  private queue: string[] = []
  private waiter?: () => void
  private aborter?: (err: any) => void
  public log = false

  async send(message: string): Promise<void> {
    // HACK: If the string "$remove$" appears in the message, remove it. This is used in some
    //   tests to hack the RPC protocol.
    message = message.replaceAll('$remove$', '')

    if (this.log)
      // eslint-disable-next-line no-console
      console.log(`${this.name}: ${message}`)
    this.partner!.queue.push(message)
    if (this.partner!.waiter) {
      this.partner!.waiter()
      this.partner!.waiter = undefined
      this.partner!.aborter = undefined
    }
  }

  async receive(): Promise<string> {
    if (this.queue.length === 0) {
      await new Promise<void>((resolve, reject) => {
        this.waiter = resolve
        this.aborter = reject
      })
    }

    return this.queue.shift()!
  }

  forceReceiveError(error: any) {
    this.aborter!(error)
  }
}

// Spin the microtask queue a bit to give messages time to be delivered and handled.
async function pumpMicrotasks() {
  for (let i = 0; i < 16; i++) {
    await Promise.resolve()
  }
}

export class TestHarness<T extends RpcTarget> {
  clientTransport: TestTransport
  serverTransport: TestTransport
  client: RpcSession<T>
  server: RpcSession

  stub: RpcStub<T>

  constructor(target: T, serverOptions: RpcSessionOptions = {
    onSendError: (error) => {
      // console.log('onSendError:', inspect(error, { depth: null }))
      return error
    },
  }) {
    this.clientTransport = new TestTransport('client')
    this.serverTransport = new TestTransport('server', this.clientTransport)

    this.client = new RpcSession<T>(this.clientTransport, undefined)

    // TODO: If I remove `<undefined>` here, I get a TypeScript error about the instantiation being
    //   excessively deep and possibly infinite. Why? `<undefined>` is supposed to be the default.
    this.server = new RpcSession<undefined>(this.serverTransport, target, serverOptions)

    this.stub = this.client.getRemoteMain()
  }

  // Enable logging of all messages sent. Useful for debugging.
  enableLogging() {
    this.clientTransport.log = true
    this.serverTransport.log = true
  }

  checkAllDisposed() {
    expect(this.client.getStats(), 'client').toStrictEqual({ imports: 1, exports: 1 })
    expect(this.server.getStats(), 'server').toStrictEqual({ imports: 1, exports: 1 })
  }

  async [Symbol.asyncDispose]() {
    try {
      // HACK: Spin the microtask loop for a bit to make sure dispose messages have been sent
      //   and received.
      await pumpMicrotasks()

      // Check at the end of every test that everything was disposed.
      this.checkAllDisposed()
    }
    catch (err) {
      // Don't throw from disposer as it may suppress the real error that caused the disposal in
      // the first place.

      // I couldn't find a better way to make vitest log a failure without throwing...
      let message: string
      if (err instanceof Error) {
        message = err.stack || err.message
      }
      else {
        message = `${err}`
      }
      expect.soft(true, message).toBe(false)
    }
  }
}
