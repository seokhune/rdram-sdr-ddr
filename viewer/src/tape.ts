import { applyEvent, emptySnapshot, type Snapshot } from '../../viz/fold.ts'
import { fifoIdFor, type ArchName, type TraceEvent } from '../../viz/schema.ts'

export type BankSpan = {
  bank: number
  state: string
  start: number
  end: number
  openRow: number | null
}

export type TraceIndex = {
  commands: { tick: number; bank: number; decoded: string; pins: { cs: number; ras: number; cas: number; we: number } }[]
  banks: BankSpan[]
  pins: { tick: number; wordIndex: number; reqId: number }[]
  channels: { txnId: number; seg: string; start: number; end: number }[]
  half: { bank: number; start: number; end: number }[]
  refresh: { start: number; end: number; lockedBank: number | null; mode: string }[]
  edges: { tick: number; edge: 'rise' | 'fall' }[]
  transits: { token: string | null; pushTick: number; popTick: number | null }[]
  reqBank: Map<number, number>
  fifoId: string
}

function ordered(events: readonly TraceEvent[]): TraceEvent[] {
  return events
    .map((event, order) => ({ event, order }))
    .sort((left, right) => {
      const leftTick = left.event.kind === 'sim' ? -1 : left.event.tick
      const rightTick = right.event.kind === 'sim' ? -1 : right.event.tick
      if (leftTick !== rightTick) return leftTick - rightTick
      return left.order - right.order
    })
    .map((item) => item.event)
}

export function indexTrace(events: readonly TraceEvent[]): TraceIndex {
  const header = events[0]
  if (!header || header.kind !== 'sim') throw new Error('trace is missing the sim header')
  const total = header.totalTicks
  const banks: BankSpan[] = []
  const open = new Map<number, BankSpan>()
  for (let bank = 0; bank < header.params.banks; bank += 1) {
    const span: BankSpan = { bank, state: 'idle', start: 0, end: total, openRow: null }
    open.set(bank, span)
    banks.push(span)
  }
  const commands: TraceIndex['commands'] = []
  const pins: TraceIndex['pins'] = []
  const channels: TraceIndex['channels'] = []
  const half: TraceIndex['half'] = []
  const refresh: TraceIndex['refresh'] = []
  const edges: TraceIndex['edges'] = []
  const reqBank = new Map<number, number>()
  const held = new Map<number, number>()
  let channelOpen: { txnId: number; seg: string; start: number } | null = null
  let refreshOpen: { start: number; lockedBank: number | null; mode: string } | null = null
  const pipe: { token: string | null; pushTick: number; popTick: number | null }[] = []
  const transits: TraceIndex['transits'] = []
  for (let slot = 0; slot < header.params.casClocks; slot += 1) {
    const transit = { token: null, pushTick: 0, popTick: null }
    pipe.push(transit)
    transits.push(transit)
  }
  const fifoId = fifoIdFor(header.arch)
  for (const event of events) {
    if (event.kind === 'cmd') commands.push({ tick: event.tick, bank: event.bank, decoded: event.decoded, pins: event.pins })
    if (event.kind === 'edge') edges.push({ tick: event.tick, edge: event.edge })
    if (event.kind === 'pin') pins.push({ tick: event.tick, wordIndex: event.wordIndex, reqId: event.reqId })
    if (event.kind === 'reqSummary') reqBank.set(event.id, event.bank)
    if (event.kind === 'bank' && event.from !== event.to) {
      const current = open.get(event.bank)
      if (current) current.end = event.tick
      const next: BankSpan = { bank: event.bank, state: event.to, start: event.tick, end: total, openRow: event.openRow }
      open.set(event.bank, next)
      banks.push(next)
    }
    if (event.kind === 'chan' && event.phase === 'begin') {
      if (channelOpen) throw new Error('channel segment began while another segment was open')
      channelOpen = { txnId: event.txnId, seg: event.seg, start: event.tick }
    }
    if (event.kind === 'chan' && event.phase === 'end') {
      if (!channelOpen || channelOpen.txnId !== event.txnId || channelOpen.seg !== event.seg) {
        throw new Error('channel end without a matching begin')
      }
      channels.push({ ...channelOpen, end: event.tick })
      channelOpen = null
    }
    if (event.kind === 'halfrow' && event.phase === 'occupy') held.set(event.bank, event.tick)
    if (event.kind === 'halfrow' && event.phase === 'release') {
      const start = held.get(event.bank)
      if (start === undefined) throw new Error(`bank ${event.bank} released without an occupy`)
      half.push({ bank: event.bank, start, end: event.tick })
      held.delete(event.bank)
    }
    if (event.kind === 'refresh' && event.phase === 'busy') {
      refreshOpen = { start: event.tick, lockedBank: event.lockedBank, mode: event.mode }
    }
    if (event.kind === 'refresh' && event.phase === 'done' && refreshOpen) {
      refresh.push({ ...refreshOpen, end: event.tick })
      refreshOpen = null
    }
    if (event.kind === 'fifo' && event.fifoId === fifoId && event.op === 'pop') {
      const head = pipe.shift()
      if (head) head.popTick = event.tick
    }
    if (event.kind === 'fifo' && event.fifoId === fifoId && event.op === 'push') {
      const transit = { token: event.token, pushTick: event.tick, popTick: null }
      pipe.push(transit)
      transits.push(transit)
    }
  }
  return { commands, banks, pins, channels, half, refresh, edges, transits, reqBank, fifoId }
}

export class Cursor {
  private events: TraceEvent[]
  private index = 1
  private snap: Snapshot

  constructor(events: readonly TraceEvent[]) {
    const header = events[0]
    if (!header || header.kind !== 'sim') throw new Error('trace is missing the sim header')
    this.events = ordered(events)
    this.snap = emptySnapshot(header)
  }

  seek(tick: number): Snapshot {
    const bounded = Math.max(0, Math.min(tick, this.snap.totalTicks))
    if (bounded < this.snap.tick) {
      const header = this.events[0]
      if (!header || header.kind !== 'sim') throw new Error('trace is missing the sim header')
      this.snap = emptySnapshot(header)
      this.index = 1
    }
    while (this.index < this.events.length) {
      const event = this.events[this.index]
      if (event.kind !== 'sim' && event.tick > bounded) break
      applyEvent(this.snap, event)
      this.index += 1
    }
    this.snap.tick = bounded
    return { ...this.snap }
  }
}

export function headerOf(events: readonly TraceEvent[]): Extract<TraceEvent, { kind: 'sim' }> {
  const header = events[0]
  if (!header || header.kind !== 'sim') throw new Error('trace is missing the sim header')
  return header
}

export function visible<T extends { start: number; end: number }>(items: readonly T[], origin: number, span: number): T[] {
  const end = origin + span
  return items.filter((item) => item.end > origin && item.start < end)
}

export type ArchNameUsed = ArchName
