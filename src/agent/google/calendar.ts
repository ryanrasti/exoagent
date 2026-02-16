import { google, calendar_v3 } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import { z } from 'zod'
import { ExoAgent } from '../../policy'

type Event = calendar_v3.Schema$Event

// ExoAgent for Calendar with calendar as source and sink
export const calendarExo = new ExoAgent(['calendar'] as const, ['calendar'] as const)

export interface CalendarEvent {
  id: string
  summary: string | undefined
  description: string | undefined
  location: string | undefined
  start: { dateTime?: string; date?: string } | undefined
  end: { dateTime?: string; date?: string } | undefined
  htmlLink: string | undefined
  attendees: string[]
}

function toCalendarEvent(event: Event): CalendarEvent {
  return {
    id: event.id!,
    summary: event.summary ?? undefined,
    description: event.description ?? undefined,
    location: event.location ?? undefined,
    start: event.start ? { dateTime: event.start.dateTime ?? undefined, date: event.start.date ?? undefined } : undefined,
    end: event.end ? { dateTime: event.end.dateTime ?? undefined, date: event.end.date ?? undefined } : undefined,
    htmlLink: event.htmlLink ?? undefined,
    attendees: (event.attendees ?? []).map(a => a.email).filter((x): x is string => !!x),
  }
}

/** Interface for Calendar operations */
export interface ICalendar {
  list(opts: { maxResults: number, timeMin: string, timeMax?: string, calendarId?: string }): Promise<CalendarEvent[]>
  get(opts: { eventId: string, calendarId?: string }): Promise<CalendarEvent>
  create(opts: { summary: string, description?: string, location?: string, start: string, end: string, attendees?: string[], calendarId?: string }): Promise<CalendarEvent>
  update(opts: { eventId: string, summary?: string, description?: string, location?: string, start?: string, end?: string, attendees?: string[], calendarId?: string }): Promise<CalendarEvent>
  delete(opts: { eventId: string, calendarId?: string }): Promise<{ success: boolean }>
  quickAdd(opts: { text: string, calendarId?: string }): Promise<CalendarEvent>
}

export class CalendarClient implements ICalendar {
  private calendar: calendar_v3.Calendar

  constructor(auth: OAuth2Client) {
    this.calendar = google.calendar({ version: 'v3', auth })
  }

  @calendarExo.tool(z.object({
    maxResults: z.number(),
    timeMin: z.string(),
    timeMax: z.string().optional(),
    calendarId: z.string().optional(),
  }), {
    source: 'calendar',
  })
  async list({ maxResults, timeMin, timeMax, calendarId }: {
    maxResults: number
    timeMin: string
    timeMax?: string
    calendarId?: string
  }): Promise<CalendarEvent[]> {
    const res = await this.calendar.events.list({
      calendarId: calendarId || 'primary',
      timeMin,
      timeMax,
      maxResults,
      singleEvents: true,
      orderBy: 'startTime',
    })
    return (res.data.items || []).map(toCalendarEvent)
  }

  // Dynamic source: event content is tainted with attendees who have access
  @calendarExo.tool(z.object({
    eventId: z.string(),
    calendarId: z.string().optional(),
  }), {
    source: (event: CalendarEvent): ['calendar', { principals: string[] }] => [
      'calendar',
      { principals: event.attendees },
    ],
  })
  async get({ eventId, calendarId }: { eventId: string; calendarId?: string }): Promise<CalendarEvent> {
    const res = await this.calendar.events.get({
      calendarId: calendarId || 'primary',
      eventId,
    })
    return toCalendarEvent(res.data)
  }

  // Dynamic sink: check attendees against incoming taints
  @calendarExo.tool(z.object({
    summary: z.string(),
    description: z.string().optional(),
    location: z.string().optional(),
    start: z.string(),
    end: z.string(),
    attendees: z.array(z.string()).optional(),
    calendarId: z.string().optional(),
  }), {
    sink: ({ attendees }: { attendees?: string[] }): ['calendar', { principals: string[] }] => [
      'calendar',
      { principals: attendees ?? [] },
    ],
  })
  async create({ summary, description, location, start, end, attendees, calendarId }: {
    summary: string
    description?: string
    location?: string
    start: string
    end: string
    attendees?: string[]
    calendarId?: string
  }): Promise<CalendarEvent> {
    const res = await this.calendar.events.insert({
      calendarId: calendarId || 'primary',
      requestBody: {
        summary,
        description,
        location,
        start: { dateTime: start },
        end: { dateTime: end },
        attendees: attendees?.map(email => ({ email })),
      },
    })
    return toCalendarEvent(res.data)
  }

  @calendarExo.tool(z.object({
    eventId: z.string(),
    summary: z.string().optional(),
    description: z.string().optional(),
    location: z.string().optional(),
    start: z.string().optional(),
    end: z.string().optional(),
    attendees: z.array(z.string()).optional(),
    calendarId: z.string().optional(),
  }), {
    sink: ({ attendees }: { attendees?: string[] }): ['calendar', { principals: string[] }] => [
      'calendar',
      { principals: attendees ?? [] },
    ],
  })
  async update({ eventId, summary, description, location, start, end, attendees, calendarId }: {
    eventId: string
    summary?: string
    description?: string
    location?: string
    start?: string
    end?: string
    attendees?: string[]
    calendarId?: string
  }): Promise<CalendarEvent> {
    const res = await this.calendar.events.patch({
      calendarId: calendarId || 'primary',
      eventId,
      requestBody: {
        summary,
        description,
        location,
        start: start ? { dateTime: start } : undefined,
        end: end ? { dateTime: end } : undefined,
        attendees: attendees?.map(email => ({ email })),
      },
    })
    return toCalendarEvent(res.data)
  }

  @calendarExo.tool(z.object({
    eventId: z.string(),
    calendarId: z.string().optional(),
  }))
  async delete({ eventId, calendarId }: { eventId: string; calendarId?: string }): Promise<{ success: boolean }> {
    await this.calendar.events.delete({
      calendarId: calendarId || 'primary',
      eventId,
    })
    return { success: true }
  }

  @calendarExo.tool(z.object({
    text: z.string(),
    calendarId: z.string().optional(),
  }))
  async quickAdd({ text, calendarId }: { text: string; calendarId?: string }): Promise<CalendarEvent> {
    const res = await this.calendar.events.quickAdd({
      calendarId: calendarId || 'primary',
      text,
    })
    return toCalendarEvent(res.data)
  }
}

/** Default seed data for mock Calendar */
export const MOCK_CALENDAR_SEED: CalendarEvent[] = [
  {
    id: 'event-1',
    summary: 'Team standup',
    description: 'Daily standup meeting',
    location: 'Conference Room A',
    start: { dateTime: '2024-01-16T09:00:00Z' },
    end: { dateTime: '2024-01-16T09:30:00Z' },
    htmlLink: 'https://calendar.google.com/event?eid=event-1',
    attendees: ['me@example.com', 'alice@example.com'],
  },
]

/** Type definitions for LLM */
export const CALENDAR_DTS = `
interface CalendarEvent {
  id: string
  summary: string | undefined
  description: string | undefined
  location: string | undefined
  start: { dateTime?: string; date?: string } | undefined
  end: { dateTime?: string; date?: string } | undefined
  htmlLink: string | undefined
  attendees: string[]
}

interface Calendar {
  /** List events in a time range */
  list(opts: { maxResults: number, timeMin: string, timeMax?: string, calendarId?: string }): Promise<CalendarEvent[]>

  /** Get a specific event */
  get(opts: { eventId: string, calendarId?: string }): Promise<CalendarEvent>

  /** Create a new event */
  create(opts: { summary: string, description?: string, location?: string, start: string, end: string, attendees?: string[], calendarId?: string }): Promise<CalendarEvent>

  /** Update an existing event */
  update(opts: { eventId: string, summary?: string, description?: string, location?: string, start?: string, end?: string, attendees?: string[], calendarId?: string }): Promise<CalendarEvent>

  /** Delete an event */
  delete(opts: { eventId: string, calendarId?: string }): Promise<{ success: boolean }>

  /** Quick add event from natural language */
  quickAdd(opts: { text: string, calendarId?: string }): Promise<CalendarEvent>
}
`

/** Mock Calendar client with in-memory state for testing */
export class MockCalendarClient implements ICalendar {
  static dts = CALENDAR_DTS
  private events: Map<string, CalendarEvent> = new Map()
  private nextId = 1

  constructor(seedData: CalendarEvent[] = MOCK_CALENDAR_SEED) {
    this.seed(seedData)
  }

  /** Seed events for testing */
  seed(events: CalendarEvent[]): void {
    for (const event of events) {
      this.events.set(event.id, event)
    }
  }

  /** Get current state for assertions */
  getState(): { events: CalendarEvent[] } {
    return { events: [...this.events.values()] }
  }

  /** Clear all state */
  clear(): void {
    this.events.clear()
    this.nextId = 1
  }

  @calendarExo.tool(z.object({
    maxResults: z.number(),
    timeMin: z.string(),
    timeMax: z.string().optional(),
    calendarId: z.string().optional(),
  }), {
    source: 'calendar',
  })
  async list({ maxResults, timeMin, timeMax }: {
    maxResults: number
    timeMin: string
    timeMax?: string
    calendarId?: string
  }): Promise<CalendarEvent[]> {
    const minDate = new Date(timeMin)
    const maxDate = timeMax ? new Date(timeMax) : null

    const events = [...this.events.values()].filter((e) => {
      const startStr = e.start?.dateTime || e.start?.date
      if (!startStr) return false
      const start = new Date(startStr)
      if (start < minDate) return false
      if (maxDate && start > maxDate) return false
      return true
    })

    return events.slice(0, maxResults)
  }

  @calendarExo.tool(z.object({
    eventId: z.string(),
    calendarId: z.string().optional(),
  }), {
    source: (event: CalendarEvent): ['calendar', { principals: string[] }] => [
      'calendar',
      { principals: event.attendees },
    ],
  })
  async get({ eventId }: { eventId: string, calendarId?: string }): Promise<CalendarEvent> {
    const event = this.events.get(eventId)
    if (!event) {
      throw new Error(`Event not found: ${eventId}`)
    }
    return event
  }

  @calendarExo.tool(z.object({
    summary: z.string(),
    description: z.string().optional(),
    location: z.string().optional(),
    start: z.string(),
    end: z.string(),
    attendees: z.array(z.string()).optional(),
    calendarId: z.string().optional(),
  }), {
    sink: ({ attendees }: { attendees?: string[] }): ['calendar', { principals: string[] }] => [
      'calendar',
      { principals: attendees ?? [] },
    ],
  })
  async create({ summary, description, location, start, end, attendees }: {
    summary: string
    description?: string
    location?: string
    start: string
    end: string
    attendees?: string[]
    calendarId?: string
  }): Promise<CalendarEvent> {
    const id = `event-${this.nextId++}`
    const event: CalendarEvent = {
      id,
      summary,
      description,
      location,
      start: { dateTime: start },
      end: { dateTime: end },
      htmlLink: `https://calendar.google.com/event?eid=${id}`,
      attendees: attendees ?? [],
    }
    this.events.set(id, event)
    return event
  }

  @calendarExo.tool(z.object({
    eventId: z.string(),
    summary: z.string().optional(),
    description: z.string().optional(),
    location: z.string().optional(),
    start: z.string().optional(),
    end: z.string().optional(),
    attendees: z.array(z.string()).optional(),
    calendarId: z.string().optional(),
  }), {
    sink: ({ attendees }: { attendees?: string[] }): ['calendar', { principals: string[] }] => [
      'calendar',
      { principals: attendees ?? [] },
    ],
  })
  async update({ eventId, summary, description, location, start, end, attendees }: {
    eventId: string
    summary?: string
    description?: string
    location?: string
    start?: string
    end?: string
    attendees?: string[]
    calendarId?: string
  }): Promise<CalendarEvent> {
    const existing = this.events.get(eventId)
    if (!existing) {
      throw new Error(`Event not found: ${eventId}`)
    }
    const updated: CalendarEvent = {
      ...existing,
      summary: summary ?? existing.summary,
      description: description ?? existing.description,
      location: location ?? existing.location,
      start: start ? { dateTime: start } : existing.start,
      end: end ? { dateTime: end } : existing.end,
      attendees: attendees ?? existing.attendees,
    }
    this.events.set(eventId, updated)
    return updated
  }

  @calendarExo.tool(z.object({
    eventId: z.string(),
    calendarId: z.string().optional(),
  }))
  async delete({ eventId }: { eventId: string, calendarId?: string }): Promise<{ success: boolean }> {
    if (!this.events.has(eventId)) {
      throw new Error(`Event not found: ${eventId}`)
    }
    this.events.delete(eventId)
    return { success: true }
  }

  @calendarExo.tool(z.object({
    text: z.string(),
    calendarId: z.string().optional(),
  }))
  async quickAdd({ text }: { text: string, calendarId?: string }): Promise<CalendarEvent> {
    // Simple parsing: assume format like "Meeting tomorrow at 3pm"
    const id = `event-${this.nextId++}`
    const now = new Date()
    const event: CalendarEvent = {
      id,
      summary: text,
      description: undefined,
      location: undefined,
      start: { dateTime: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString() },
      end: { dateTime: new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString() },
      htmlLink: `https://calendar.google.com/event?eid=${id}`,
      attendees: [],
    }
    this.events.set(id, event)
    return event
  }
}
