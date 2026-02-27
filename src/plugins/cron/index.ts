import { CronJob } from 'cron'

export interface ScheduledJob {
  id: string
  schedule: string
  running: boolean
  lastRun?: Date
  nextRun?: Date
}

export class Cron {
  private jobs: Map<string, { job: CronJob, schedule: string, running: boolean, lastRun?: Date }> = new Map()
  private nextId = 1

  /**
   * Schedule a job to run on a cron schedule.
   * @param schedule Cron expression (second minute hour dayOfMonth month dayOfWeek)
   *                 or standard 5-field format (minute hour dayOfMonth month dayOfWeek)
   * @param callback Function to call when the schedule triggers
   * @returns Job ID
   */
  schedule(schedule: string, callback: () => void | Promise<void>): string {
    const id = `cron-${this.nextId++}`

    const entry = {
      job: null as unknown as CronJob,
      schedule,
      running: false,
      lastRun: undefined as Date | undefined,
    }

    const job = new CronJob(schedule, async () => {
      if (entry.running) return
      entry.running = true
      entry.lastRun = new Date()
      try {
        await callback()
      }
      catch (err) {
        console.error(`Cron job ${id} failed:`, err)
      }
      finally {
        entry.running = false
      }
    })

    entry.job = job
    this.jobs.set(id, entry)
    job.start()

    return id
  }

  /**
   * Cancel a scheduled job.
   */
  cancel(id: string): boolean {
    const entry = this.jobs.get(id)
    if (!entry) return false

    entry.job.stop()
    this.jobs.delete(id)
    return true
  }

  /**
   * List all scheduled jobs.
   */
  list(): ScheduledJob[] {
    return Array.from(this.jobs.entries()).map(([id, entry]) => ({
      id,
      schedule: entry.schedule,
      running: entry.running,
      lastRun: entry.lastRun,
      nextRun: entry.job.nextDate()?.toJSDate(),
    }))
  }

  /**
   * Stop all jobs and clean up.
   */
  stop(): void {
    for (const entry of this.jobs.values()) {
      entry.job.stop()
    }
    this.jobs.clear()
  }
}
