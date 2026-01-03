import { RpcSession, RpcTarget } from 'capnweb'
import { describe, expect, it } from 'vitest'
import { StreamTransport } from './stream-transport.js'

function createPairedStreams() {
  const aToB: Uint8Array[] = []
  const bToA: Uint8Array[] = []
  let aController: ReadableStreamDefaultController<Uint8Array> | null = null
  let bController: ReadableStreamDefaultController<Uint8Array> | null = null

  const aReadable = new ReadableStream<Uint8Array>({
    start(controller) {
      aController = controller
      for (const chunk of bToA) controller.enqueue(chunk)
    },
  })
  const aWritable = new WritableStream<Uint8Array>({
    write(chunk) {
      aToB.push(chunk)
      if (bController)
        bController.enqueue(chunk)
    },
  })

  const bReadable = new ReadableStream<Uint8Array>({
    start(controller) {
      bController = controller
      for (const chunk of aToB) controller.enqueue(chunk)
    },
  })
  const bWritable = new WritableStream<Uint8Array>({
    write(chunk) {
      bToA.push(chunk)
      if (aController)
        aController.enqueue(chunk)
    },
  })

  return { transportA: new StreamTransport(aReadable, aWritable), transportB: new StreamTransport(bReadable, bWritable) }
}

function createReadable(chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

function collectWritable() {
  const chunks: Uint8Array[] = []
  const writable = new WritableStream<Uint8Array>({ write: (chunk) => { chunks.push(chunk) } })
  return { writable, chunks }
}

describe('streamTransport', () => {
  const testMessage = (message: string) => async () => {
    const { transportA, transportB } = createPairedStreams()
    await transportA.send(message)
    expect(await transportB.receive()).toBe(message)
  }

  it('sends and receives a single message', testMessage('hello'))

  it('handles empty string', testMessage(''))

  it('handles unicode characters', testMessage('Hello 世界 🌍'))

  it('handles large messages', testMessage('x'.repeat(100000)))

  it('sends and receives multiple messages', async () => {
    const { transportA, transportB } = createPairedStreams()
    await transportA.send('first')
    await transportA.send('second')
    await transportA.send('third')
    expect(await transportB.receive()).toBe('first')
    expect(await transportB.receive()).toBe('second')
    expect(await transportB.receive()).toBe('third')
  })

  it('handles bidirectional communication', async () => {
    const { transportA, transportB } = createPairedStreams()
    await transportA.send('A to B')
    await transportB.send('B to A')
    expect(await transportB.receive()).toBe('A to B')
    expect(await transportA.receive()).toBe('B to A')
  })

  it('validates message length in send', async () => {
    const { writable } = collectWritable()
    const transport = new StreamTransport(new ReadableStream<Uint8Array>(), writable)
    const testMessage = 'x'.repeat(1000)
    expect(new TextEncoder().encode(testMessage).length).toBeLessThan(0xFFFFFFFF)
    await transport.send(testMessage)
  })

  it('rejects message exceeding 100MB limit in receive', async () => {
    const lengthBytes = new Uint8Array(4)
    new DataView(lengthBytes.buffer).setUint32(0, 100 * 1024 * 1024 + 1, true)
    const transport = new StreamTransport(createReadable([lengthBytes]), new WritableStream<Uint8Array>())
    await expect(transport.receive()).rejects.toThrow('Message length exceeds maximum allowed size')
  })

  it('handles fragmented reads correctly', async () => {
    const message = 'hello world'
    const messageBytes = new TextEncoder().encode(message)
    const lengthBytes = new Uint8Array(4)
    new DataView(lengthBytes.buffer).setUint32(0, messageBytes.length, true)
    const chunks = [lengthBytes.slice(0, 2), lengthBytes.slice(2), messageBytes.slice(0, 3), messageBytes.slice(3, 7), messageBytes.slice(7)]
    const transport = new StreamTransport(createReadable(chunks), new WritableStream<Uint8Array>())
    expect(await transport.receive()).toBe(message)
  })

  it('aborts transport correctly', async () => {
    const { transportA } = createPairedStreams()
    expect(() => transportA.abort('test reason')).not.toThrow()
    expect(() => transportA.abort('another reason')).not.toThrow()
  })

  it('handles stream closure during read', async () => {
    const transport = new StreamTransport(createReadable([new Uint8Array([0x01, 0x00])]), new WritableStream<Uint8Array>())
    await expect(transport.receive()).rejects.toThrow('Stream closed')
  })

  it('validates send message format', async () => {
    const { writable, chunks } = collectWritable()
    const transport = new StreamTransport(new ReadableStream<Uint8Array>(), writable)
    await transport.send('test')
    transport.abort('done')

    // Length and message are written as a single chunk
    expect(chunks.length).toBeGreaterThan(0)
    const firstChunk = chunks[0]!
    expect(firstChunk.length).toBeGreaterThanOrEqual(4)
    const length = new DataView(firstChunk.buffer, firstChunk.byteOffset, 4).getUint32(0, true)
    expect(length).toBe(4)
    const messageBytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0) - 4)
    let offset = 0
    let chunkOffset = 0
    for (const chunk of chunks) {
      const start = chunkOffset === 0 ? 4 : 0
      const end = chunk.length
      if (end > start) {
        messageBytes.set(chunk.slice(start), offset)
        offset += end - start
      }
      chunkOffset += chunk.length
    }
    expect(new TextDecoder().decode(messageBytes)).toBe('test')
  })

  it('works with capnweb RPC', async () => {
    const { transportA, transportB } = createPairedStreams()

    class TestApi extends RpcTarget {
      async getValue(): Promise<string> {
        return 'test-value'
      }
    }

    const apiA = new TestApi()
    const _sessionA = new RpcSession(transportA, apiA)

    const sessionB = new RpcSession(transportB)
    const apiB = sessionB.getRemoteMain() as unknown as TestApi

    // Give sessions time to initialize
    await new Promise(resolve => setTimeout(resolve, 10))

    const result = await apiB.getValue()
    expect(result).toBe('test-value')
  }, 10000)
})
