/**
 * Test REPL persistence - variables should persist across turns
 */

import { describe, it, expect } from 'vitest'
import { codeMode, GlobalScope } from '../../code-mode'
import { createMockAgent, mockPolicy } from './index'
import { registerArrayValueFactory } from '../../eval'
import { serializeScope, deserializeScope } from '../../eval/scope'

registerArrayValueFactory()

describe('REPL persistence', () => {
  it('persists variables across multiple executions', async () => {
    // Track responses
    const responses: string[] = []
    const mockAgent = createMockAgent({
      onRespond: (msg) => responses.push(msg),
    })

    // First execution - define a variable
    let scope1: GlobalScope | undefined
    const tool1 = codeMode({
      globals: { api: mockAgent.api, builtin: mockAgent.builtin },
      policy: mockPolicy,
      dts: '',
      outputSink: 'email',
      inputTaints: [],
      maxCost: 10,
      onScope: (s) => { scope1 = s },
    })

    const result1 = await tool1.execute({ code: 'const x = 42' }, {} as any)
    expect(result1.error).toBeUndefined()
    expect(scope1).toBeDefined()

    // Second execution - reuse the scope, reference the variable
    const tool2 = codeMode({
      globals: { api: mockAgent.api, builtin: mockAgent.builtin },
      policy: mockPolicy,
      dts: '',
      outputSink: 'email',
      inputTaints: [],
      maxCost: 10,
      scope: scope1, // Pass the scope from first execution
    })

    const result2 = await tool2.execute({ code: 'builtin.respond(`x is ${x}`)' }, {} as any)
    expect(result2.error).toBeUndefined()
    expect(responses).toContain('x is 42')
  })

  it('preserves taints on persisted variables', async () => {
    const mockAgent = createMockAgent()

    // First execution - get an email (which has taints)
    let scope1: GlobalScope | undefined
    const tool1 = codeMode({
      globals: { api: mockAgent.api, builtin: mockAgent.builtin },
      policy: mockPolicy,
      dts: '',
      outputSink: 'email',
      inputTaints: [],
      maxCost: 10,
      onScope: (s) => { scope1 = s },
    })

    const result1 = await tool1.execute({ code: 'const email = await api.gmail.get({ id: "email-1" })' }, {} as any)
    expect(result1.error).toBeUndefined()

    // Second execution - access the tainted variable
    const tool2 = codeMode({
      globals: { api: mockAgent.api, builtin: mockAgent.builtin },
      policy: mockPolicy,
      dts: '',
      outputSink: 'email',
      inputTaints: [],
      maxCost: 10,
      scope: scope1,
    })

    const result2 = await tool2.execute({ code: 'email' }, {} as any)
    expect(result2.error).toBeUndefined()
    // The result should have the taints from the original email
    expect(result2.taints!.length).toBeGreaterThan(0)
    expect(result2.taints![0][0]).toBe('email')
  })

  it('survives serialization/deserialization (DB persistence)', async () => {
    const responses: string[] = []
    const mockAgent = createMockAgent({
      onRespond: (msg) => responses.push(msg),
    })

    // First execution - define variables
    let scope1: GlobalScope | undefined
    const tool1 = codeMode({
      globals: { api: mockAgent.api, builtin: mockAgent.builtin },
      policy: mockPolicy,
      dts: '',
      outputSink: 'email',
      inputTaints: [],
      maxCost: 10,
      onScope: (s) => { scope1 = s },
    })

    const result1 = await tool1.execute({ code: 'const x = 42\nconst y = "hello"' }, {} as any)
    expect(result1.error).toBeUndefined()

    // Serialize to JSON (simulating DB storage)
    const serialized = serializeScope(scope1!)
    const json = JSON.stringify(serialized)

    // Deserialize from JSON (simulating DB load)
    const restored = JSON.parse(json)
    const restoredScope = deserializeScope(restored)

    // Use restored scope in new execution
    const tool2 = codeMode({
      globals: { api: mockAgent.api, builtin: mockAgent.builtin },
      policy: mockPolicy,
      dts: '',
      outputSink: 'email',
      inputTaints: [],
      maxCost: 10,
      scope: restoredScope,
    })

    const result2 = await tool2.execute({ code: 'builtin.respond(`x=${x}, y=${y}`)' }, {} as any)
    expect(result2.error).toBeUndefined()
    expect(responses).toContain('x=42, y=hello')
  })

  it('preserves taints through serialization/deserialization', async () => {
    const mockAgent = createMockAgent()

    // First execution - store a tainted simple value
    let scope1: GlobalScope | undefined
    const tool1 = codeMode({
      globals: { api: mockAgent.api, builtin: mockAgent.builtin },
      policy: mockPolicy,
      dts: '',
      outputSink: 'email',
      inputTaints: [],
      maxCost: 10,
      onScope: (s) => { scope1 = s },
    })

    // Get email and extract just the subject (a simple string that preserves taints)
    const result1 = await tool1.execute({
      code: 'const subject = (await api.gmail.get({ id: "email-1" })).subject',
    }, {} as any)
    expect(result1.error).toBeUndefined()

    // Serialize and deserialize
    const serialized = serializeScope(scope1!)
    const json = JSON.stringify(serialized)
    const restoredScope = deserializeScope(JSON.parse(json))

    // Access tainted variable after restoration
    const tool2 = codeMode({
      globals: { api: mockAgent.api, builtin: mockAgent.builtin },
      policy: mockPolicy,
      dts: '',
      outputSink: 'email',
      inputTaints: [],
      maxCost: 10,
      scope: restoredScope,
    })

    const result2 = await tool2.execute({ code: 'subject' }, {} as any)
    expect(result2.error).toBeUndefined()
    expect(result2.taints!.length).toBeGreaterThan(0)
    expect(result2.taints![0][0]).toBe('email')
  })

  it('persists Date objects through serialization', async () => {
    const mockAgent = createMockAgent()

    // Create a scope with an EmailMessage containing a Date
    let scope1: GlobalScope | undefined
    const tool1 = codeMode({
      globals: { api: mockAgent.api, builtin: mockAgent.builtin },
      policy: mockPolicy,
      dts: '',
      outputSink: 'email',
      inputTaints: [],
      maxCost: 10,
      onScope: (s) => { scope1 = s },
    })

    const result1 = await tool1.execute({
      code: 'const email = await api.gmail.get({ id: "email-1" })',
    }, {} as any)
    expect(result1.error).toBeUndefined()

    // Serialization should work now that Date is supported
    const serialized = serializeScope(scope1!)
    const json = JSON.stringify(serialized)
    const restoredScope = deserializeScope(JSON.parse(json))

    // Use restored scope in new execution
    const tool2 = codeMode({
      globals: { api: mockAgent.api, builtin: mockAgent.builtin },
      policy: mockPolicy,
      dts: '',
      outputSink: 'email',
      inputTaints: [],
      maxCost: 10,
      scope: restoredScope,
    })

    // Access the date from the restored email
    const result2 = await tool2.execute({ code: 'email.date' }, {} as any)
    expect(result2.error).toBeUndefined()
    expect(result2.taints!.length).toBeGreaterThan(0)
    expect(result2.taints![0][0]).toBe('email')
  })

  it('supports new Date() expressions', async () => {
    const responses: string[] = []
    const mockAgent = createMockAgent({
      onRespond: (msg) => responses.push(msg),
    })

    const tool = codeMode({
      globals: { api: mockAgent.api, builtin: mockAgent.builtin },
      policy: mockPolicy,
      dts: '',
      outputSink: 'email',
      inputTaints: [],
      maxCost: 10,
    })

    const result = await tool.execute({
      code: 'const now = new Date("2024-01-15T12:00:00.000Z")\nbuiltin.respond(`Date: ${now.toISOString()}`)',
    }, {} as any)
    expect(result.error).toBeUndefined()
    expect(responses).toContain('Date: 2024-01-15T12:00:00.000Z')
  })
})
