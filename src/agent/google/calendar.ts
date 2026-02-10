import { google, calendar_v3 } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'

type Event = calendar_v3.Schema$Event
type EventInput = calendar_v3.Schema$Event

export class CalendarClient {
  private calendar: calendar_v3.Calendar

  constructor(auth: OAuth2Client) {
    this.calendar = google.calendar({ version: 'v3', auth })
  }

  async list(options: {
    maxResults?: number
    timeMin?: Date
    timeMax?: Date
    calendarId?: string
  } = {}): Promise<Event[]> {
    const res = await this.calendar.events.list({
      calendarId: options.calendarId || 'primary',
      timeMin: (options.timeMin || new Date()).toISOString(),
      timeMax: options.timeMax?.toISOString(),
      maxResults: options.maxResults || 10,
      singleEvents: true,
      orderBy: 'startTime',
    })
    return res.data.items || []
  }

  async get(eventId: string, calendarId = 'primary'): Promise<Event> {
    const res = await this.calendar.events.get({
      calendarId,
      eventId,
    })
    return res.data
  }

  async create(event: EventInput, calendarId = 'primary'): Promise<Event> {
    const res = await this.calendar.events.insert({
      calendarId,
      requestBody: event,
    })
    return res.data
  }

  async update(eventId: string, event: EventInput, calendarId = 'primary'): Promise<Event> {
    const res = await this.calendar.events.patch({
      calendarId,
      eventId,
      requestBody: event,
    })
    return res.data
  }

  async delete(eventId: string, calendarId = 'primary'): Promise<void> {
    await this.calendar.events.delete({
      calendarId,
      eventId,
    })
  }

  async quickAdd(text: string, calendarId = 'primary'): Promise<Event> {
    const res = await this.calendar.events.quickAdd({
      calendarId,
      text,
    })
    return res.data
  }
}
