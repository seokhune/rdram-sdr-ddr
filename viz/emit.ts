import type { TraceEvent } from './schema.ts'

export function toJsonl(events: readonly TraceEvent[]): string {
  return events.map((event) => JSON.stringify(event)).join('\n') + '\n'
}

export function parseJsonl(text: string): TraceEvent[] {
  const events: TraceEvent[] = []
  for (const line of text.split('\n')) {
    if (line.length === 0) continue
    const parsed: unknown = JSON.parse(line)
    if (!parsed || typeof parsed !== 'object' || !('kind' in parsed)) {
      throw new Error('trace line is missing kind')
    }
    events.push(parsed as TraceEvent)
  }
  if (events[0]?.kind !== 'sim') throw new Error('trace is missing the sim header')
  return events
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
