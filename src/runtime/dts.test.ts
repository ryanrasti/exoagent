import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateCapDts, generateDts } from './dts'

describe('generateDts', () => {
  it('generates declarations for review provider', () => {
    const dts = generateDts(resolve(__dirname, 'providers/review.ts'))
    expect(dts).toContain('ReviewCap')
    expect(dts).toContain('openPR')
    expect(dts).toContain('ReviewResult')
  })

  it('generates declarations for storage provider', () => {
    const dts = generateDts(resolve(__dirname, 'providers/storage.ts'))
    expect(dts).toContain('StorageCap')
  })
})

describe('generateCapDts', () => {
  it('extracts ReviewCap public methods', () => {
    const capDts = generateCapDts(resolve(__dirname, 'providers/review.ts'), 'ReviewCap')
    expect(capDts).toContain('openPR')
    expect(capDts).toContain('getReviews')
    // Should not contain private methods
    expect(capDts).not.toContain('ensureRemote')
    expect(capDts).not.toContain('pollForReview')
  })

  it('extracts StorageCap public methods', () => {
    const capDts = generateCapDts(resolve(__dirname, 'providers/storage.ts'), 'StorageCap')
    expect(capDts).toContain('get')
    expect(capDts).toContain('set')
  })
})
