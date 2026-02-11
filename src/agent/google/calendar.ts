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

export class CalendarClient {
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
