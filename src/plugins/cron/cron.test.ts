import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Cron } from './index'

describe('Cron', () => {
  let cron: Cron

  beforeEach(() => {
    cron = new Cron()
  })

  afterEach(() => {
    cron.stop()
  })

  it('schedules a job and returns an id', () => {
    const id = cron.schedule('* * * * *', () => {})
    expect(id).toMatch(/^cron-\d+$/)
  })

  it('lists scheduled jobs', () => {
    cron.schedule('0 * * * *', () => {})
    cron.schedule('30 * * * *', () => {})

    const jobs = cron.list()
    expect(jobs).toHaveLength(2)
    expect(jobs[0].schedule).toBe('0 * * * *')
    expect(jobs[1].schedule).toBe('30 * * * *')
  })

  it('cancels a job', () => {
    const id = cron.schedule('* * * * *', () => {})
    expect(cron.list()).toHaveLength(1)

    const result = cron.cancel(id)
    expect(result).toBe(true)
    expect(cron.list()).toHaveLength(0)
  })

  it('returns false when canceling non-existent job', () => {
    const result = cron.cancel('non-existent')
    expect(result).toBe(false)
  })

  it('throws on invalid schedule', () => {
    expect(() => cron.schedule('invalid', () => {})).toThrow()
  })

  it('stops all jobs', () => {
    cron.schedule('* * * * *', () => {})
    cron.schedule('0 * * * *', () => {})

    cron.stop()

    expect(cron.list()).toHaveLength(0)
  })

  it('provides nextRun date', () => {
    cron.schedule('0 12 * * *', () => {}) // noon every day

    const jobs = cron.list()
    expect(jobs[0].nextRun).toBeInstanceOf(Date)
  })
})
