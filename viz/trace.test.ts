import { describe, expect, it } from 'vitest'
import { sha256, toJsonl, parseJsonl } from './emit.ts'
import { foldAll } from './fold.ts'
import type { FifoEvent, TraceEvent } from './schema.ts'
import { recordScenario } from './trace.ts'

function summaryLatency(events: TraceEvent[], id = 1): number {
  const summary = events.find((event) => event.kind === 'reqSummary' && event.id === id)
  if (!summary || summary.kind !== 'reqSummary' || summary.completedAt === null) {
    throw new Error('missing summary')
  }
  return summary.completedAt - summary.enqueuedAt
}

function fifoGap(events: TraceEvent[], fifoId: string, depth: number): void {
  const fifo = events.filter((event): event is FifoEvent => event.kind === 'fifo' && event.fifoId === fifoId)
  const index = fifo.findIndex((event) => event.op === 'push' && event.token !== null)
  expect(index).toBeGreaterThanOrEqual(0)
  const token = fifo[index]?.token
  let shifts = 0
  for (let cursor = index + 1; cursor < fifo.length; cursor += 1) {
    if (fifo[cursor].op !== 'pop') continue
    shifts += 1
    if (fifo[cursor].token === token) {
      expect(shifts).toBe(depth)
      return
    }
  }
  throw new Error('token never popped')
}

describe('trace replay', () => {
  it('repeats the same hash and folds a burst', async () => {
    const once = recordScenario({ scenario: 'burst', seed: 42, arch: 'sdr', burst: 8 })
    const twice = recordScenario({ scenario: 'burst', seed: 42, arch: 'sdr', burst: 8 })
    expect(await sha256(toJsonl(once))).toBe(await sha256(toJsonl(twice)))
    const snap = foldAll(once)
    expect(summaryLatency(once)).toBe(80)
    expect(snap.requests[0]?.completedAt).toBe(80)
    fifoGap(once, 'jedec.cl', once[0].kind === 'sim' ? once[0].params.casClocks : 0)
  })

  it('matches the closed burst lengths', () => {
    const sdr = recordScenario({ scenario: 'burst', seed: 42, arch: 'sdr', burst: 8 })
    const ddr = recordScenario({ scenario: 'burst', seed: 42, arch: 'ddr', burst: 8 })
    const rdram = recordScenario({ scenario: 'burst', seed: 42, arch: 'rdram', burst: 8 })
    expect(summaryLatency(sdr)).toBe(80)
    expect(summaryLatency(ddr)).toBe(44)
    expect(summaryLatency(rdram)).toBe(63)
    foldAll(sdr)
    foldAll(ddr)
    const folded = foldAll(rdram)
    expect(folded.maxOutstanding).toBeLessThanOrEqual(4)
    const busy = recordScenario({ scenario: 'random', seed: 3, arch: 'rdram', burst: 4, concurrency: 4, count: 6 })
    const snap = foldAll(busy)
    expect(snap.maxOutstanding).toBeLessThanOrEqual(4)
    const segs = snap.channels.filter((seg) => seg.end !== null)
    for (let left = 0; left < segs.length; left += 1) {
      for (let right = left + 1; right < segs.length; right += 1) {
        const a = segs[left]
        const b = segs[right]
        const overlaps = a.start < (b.end ?? 0) && b.start < (a.end ?? 0)
        expect(overlaps).toBe(false)
      }
    }
  })

  it('shows SDR pin span twice the DDR span', () => {
    const span = (arch: 'sdr' | 'ddr') => {
      const pins = recordScenario({ scenario: 'burst', seed: 42, arch, burst: 8 }).filter((event) => event.kind === 'pin')
      const ticks = pins.map((event) => (event.kind === 'pin' ? event.tick : 0))
      return Math.max(...ticks) - Math.min(...ticks)
    }
    expect(span('sdr')).toBe(span('ddr') * 2)
  })

  it('reproduces the CL=2 waveform', () => {
    const events = recordScenario({ scenario: 'golden-cl2', seed: 1, arch: 'sdr' })
    const read = events.find((event) => event.kind === 'cmd' && event.decoded === 'READ')
    const pins = events.filter((event) => event.kind === 'pin')
    expect(read && read.kind === 'cmd' ? pins[0] : undefined).toMatchObject({ tick: 24 })
    foldAll(events)
  })

  it('throws when a fifo pop is lost', () => {
    const events = recordScenario({ scenario: 'burst', seed: 42, arch: 'sdr', burst: 1 })
    const broken = events.filter((event) => !(event.kind === 'fifo' && event.op === 'push' && event.token === '1'))
    expect(() => foldAll(broken)).toThrow(/popped/)
  })

  it('rejects a trace that does not start with the sim header', () => {
    const events = recordScenario({ scenario: 'burst', seed: 42, arch: 'ddr', burst: 1 })
    expect(parseJsonl(toJsonl(events))[0]?.kind).toBe('sim')
    expect(() => parseJsonl('{"kind":"edge","tick":0,"edge":"rise"}\n')).toThrow(/sim header/)
  })

  it('sits the closed burst form on the scenario CSV', async () => {
    const { readFileSync } = await import('node:fs')
    const lines = readFileSync('metrics/out/scenarios.csv', 'utf8').trim().split('\n')
    const header = lines[0]?.split(',') ?? []
    const ticksAt = header.indexOf('ticks')
    const form = (arch: string, burst: number) => {
      if (arch === 'sdr') return 24 + (burst - 1) * 8
      if (arch === 'ddr') return 16 + (burst - 1) * 4
      return 32 + Math.ceil((8 * burst) / 16) * 8 - 1
    }
    for (const line of lines.slice(1)) {
      const cell = line.split(',')
      if (cell[0] !== 'burst') continue
      expect(Number(cell[ticksAt])).toBe(form(cell[1] ?? '', Number(cell[2])))
    }
  })
})
