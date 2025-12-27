import type { RpcTransport } from 'capnweb'

function concatBuffers(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length)
  result.set(a, 0)
  result.set(b, a.length)
  return result
}

class BufferedReader {
  private buffer: Uint8Array
  private reader: ReadableStreamDefaultReader<Uint8Array>

  constructor(input: ReadableStream<Uint8Array>) {
    this.buffer = new Uint8Array(0)
    this.reader = input.getReader()
  }

  async read(numberOfBytes: number): Promise<Uint8Array> {
    if (numberOfBytes <= 0) {
      throw new Error('numberOfBytes must be positive')
    }
    while (this.buffer.length < numberOfBytes) {
      const result = await this.reader.read()
      if (result.done || result.value == null) {
        throw new Error('Stream closed')
      }
      this.buffer = concatBuffers(this.buffer, result.value)
    }
    const result = this.buffer.slice(0, numberOfBytes)
    this.buffer = this.buffer.slice(numberOfBytes)
    return result
  }
}

export class StreamTransport implements RpcTransport {
  private bufferReader: BufferedReader
  private writer: WritableStreamDefaultWriter<Uint8Array>

  constructor(
    private input: ReadableStream<Uint8Array>,
    private output: WritableStream<Uint8Array>,
  ) {
    this.bufferReader = new BufferedReader(input)
    this.writer = output.getWriter()
  }

  async send(message: string): Promise<void> {
    const encoder = new TextEncoder()
    const messageBytes = encoder.encode(message)
    const length = messageBytes.length

    // Validate length fits in 32-bit unsigned integer
    if (length > 0xFFFFFFFF) {
      throw new Error('Message length exceeds maximum allowed size (4GB)')
    }

    const lengthBytes = new Uint8Array(4)
    const view = new DataView(lengthBytes.buffer)
    view.setUint32(0, length, true) // true = little-endian

    // Write length and message as a single chunk to avoid fragmentation issues
    const combined = new Uint8Array(4 + length)
    combined.set(lengthBytes, 0)
    combined.set(messageBytes, 4)
    await this.writer.write(combined)
  }

  async receive(): Promise<string> {
    // Read length (4 bytes)
    const lengthBytes = await this.bufferReader.read(4)
    // Create a new buffer copy to ensure DataView reads from the correct position
    // (slice() creates a view that might share the underlying buffer)
    const lengthBuffer = new Uint8Array(lengthBytes).buffer
    const length = new DataView(lengthBuffer).getUint32(0, true) // true = little-endian

    // Validate length to prevent DoS
    if (length > 100 * 1024 * 1024) { // 100MB limit
      throw new Error('Message length exceeds maximum allowed size')
    }

    // Extract message (handle empty messages)
    if (length === 0) {
      return ''
    }
    const messageBytes = await this.bufferReader.read(length)
    const decoder = new TextDecoder()
    return decoder.decode(messageBytes)
  }

  abort(reason: unknown): void {
    this.input.cancel(reason).catch(() => {})
    // Per documentation, we want to try to write out any remaining data:
    this.writer.close().catch(() => {})
  }
}
