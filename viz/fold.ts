import type { TraceEvent } from './schema.ts'
import { fifoIdFor } from './schema.ts'

export type FifoSlot = { token: string | null; pushTick: number }

export type RequestView = {
  id: number
  enqueuedAt: number | null
  firstWordAt: number | null
  completedAt: number | null
  bank: number
  row: number
  col: number
  burst: number
  rowSpan: number
  colSpan: number
  transferSpan: number
  overlap: number
}

export type ChannelSeg = {
  txnId: number
  seg: 'ROW' | 'COL' | 'DATA'
  start: number
  end: number | null
}

export type Snapshot = {
  tick: number
  totalTicks: number
  arch: string
  scenario: string
  seed: number
  banks: { state: string; openRow: number | null; timer: number; since: number }[]
  fifos: Record<string, FifoSlot[]>
  pins: { tick: number; wordIndex: number; reqId: number }[]
  channels: ChannelSeg[]
  outstanding: number[]
  maxOutstanding: number
  halfRow: number[]
  refreshActive: boolean
  lockedBank: number | null
  nextEventAt: number | null
  refreshSpans: { start: number; end: number | null; lockedBank: number | null }[]
  requests: RequestView[]
  edges: { tick: number; edge: 'rise' | 'fall' }[]
  commands: { tick: number; bank: number; decoded: string }[]
  log: { tick: number; kind: string; detail: string }[]
}

function detail(event: TraceEvent): string {
  if (event.kind === 'cmd') return `${event.decoded} bank ${event.bank}`
  if (event.kind === 'bank') return `bank ${event.bank} ${event.from} -> ${event.to}`
  if (event.kind === 'fifo') return `${event.fifoId} ${event.op} ${event.token ?? 'bubble'}`
  if (event.kind === 'pin') return `word ${event.wordIndex} req ${event.reqId}`
  if (event.kind === 'chan') return `${event.seg} ${event.phase} txn ${event.txnId}`
  if (event.kind === 'outstanding') return `${event.phase} txn ${event.txnId} size ${event.size}`
  if (event.kind === 'halfrow') return `${event.phase} bank ${event.bank}`
  if (event.kind === 'refresh') return `${event.mode} ${event.phase}`
  if (event.kind === 'req') return `req ${event.id} ${event.phase}`
  if (event.kind === 'edge') return event.edge
  return event.kind
}

export function emptySnapshot(header: Extract<TraceEvent, { kind: 'sim' }>): Snapshot {
  const fifoId = fifoIdFor(header.arch)
  const primed: FifoSlot[] = []
  for (let slot = 0; slot < header.params.casClocks; slot += 1) primed.push({ token: null, pushTick: 0 })
  const banks = []
  for (let bank = 0; bank < header.params.banks; bank += 1) {
    banks.push({ state: 'idle', openRow: null, timer: 0, since: 0 })
  }
  return {
    tick: 0,
    totalTicks: header.totalTicks,
    arch: header.arch,
    scenario: header.scenario,
    seed: header.seed,
    banks,
    fifos: { [fifoId]: primed },
    pins: [],
    channels: [],
    outstanding: [],
    maxOutstanding: 0,
    halfRow: [],
    refreshActive: false,
    lockedBank: null,
    nextEventAt: null,
    refreshSpans: [],
    requests: [],
    edges: [],
    commands: [],
    log: [],
  }
}

function requestOf(snapshot: Snapshot, id: number): RequestView {
  const found = snapshot.requests.find((item) => item.id === id)
  if (found) return found
  const created: RequestView = {
    id,
    enqueuedAt: null,
    firstWordAt: null,
    completedAt: null,
    bank: 0,
    row: 0,
    col: 0,
    burst: 0,
    rowSpan: 0,
    colSpan: 0,
    transferSpan: 0,
    overlap: 0,
  }
  snapshot.requests.push(created)
  return created
}

export function applyEvent(snapshot: Snapshot, event: TraceEvent): void {
  if (event.kind === 'sim') return
  if (event.kind === 'reqSummary') {
    const item = requestOf(snapshot, event.id)
    item.bank = event.bank
    item.row = event.row
    item.col = event.col
    item.burst = event.burst
    item.rowSpan = event.rowSpan
    item.colSpan = event.colSpan
    item.transferSpan = event.transferSpan
    item.overlap = event.overlap
    item.enqueuedAt = event.enqueuedAt
    item.firstWordAt = event.firstWordAt
    item.completedAt = event.completedAt
    return
  }
  snapshot.log.push({ tick: event.tick, kind: event.kind, detail: detail(event) })
  if (event.kind === 'edge') {
    snapshot.edges.push({ tick: event.tick, edge: event.edge })
    return
  }
  if (event.kind === 'cmd') {
    snapshot.commands.push({ tick: event.tick, bank: event.bank, decoded: event.decoded })
    return
  }
  if (event.kind === 'bank') {
    const bank = snapshot.banks[event.bank]
    if (!bank) throw new Error(`bank ${event.bank} is outside the traced device`)
    if (bank.state !== event.from) throw new Error(`bank ${event.bank} was ${bank.state}, trace says ${event.from}`)
    bank.state = event.to
    bank.openRow = event.openRow
    bank.timer = event.timer
    bank.since = event.tick
    return
  }
  if (event.kind === 'fifo') {
    const fifo = snapshot.fifos[event.fifoId]
    if (!fifo) throw new Error(`missing fifo ${event.fifoId}`)
    if (event.op === 'pop') {
      const head = fifo.shift()
      if (!head) throw new Error(`fifo ${event.fifoId} popped while empty`)
      if (head.token !== event.token) throw new Error(`fifo ${event.fifoId} popped ${head.token}, trace says ${event.token}`)
      return
    }
    fifo.push({ token: event.token, pushTick: event.tick })
    return
  }
  if (event.kind === 'pin') {
    snapshot.pins.push({ tick: event.tick, wordIndex: event.wordIndex, reqId: event.reqId })
    return
  }
  if (event.kind === 'chan') {
    if (event.phase === 'begin') {
      if (snapshot.channels.some((seg) => seg.end === null)) throw new Error('channel segment began while another segment was open')
      snapshot.channels.push({ txnId: event.txnId, seg: event.seg, start: event.tick, end: null })
      return
    }
    const open = snapshot.channels.find((seg) => seg.end === null && seg.txnId === event.txnId && seg.seg === event.seg)
    if (!open) throw new Error(`channel end without a matching begin for txn ${event.txnId}`)
    open.end = event.tick
    return
  }
  if (event.kind === 'outstanding') {
    if (event.phase === 'track') {
      if (snapshot.outstanding.includes(event.txnId)) throw new Error(`txn ${event.txnId} tracked twice`)
      snapshot.outstanding.push(event.txnId)
    } else {
      const index = snapshot.outstanding.indexOf(event.txnId)
      if (index < 0) throw new Error(`txn ${event.txnId} completed without being tracked`)
      snapshot.outstanding.splice(index, 1)
    }
    if (snapshot.outstanding.length !== event.size) {
      throw new Error(`outstanding size ${event.size} does not match ${snapshot.outstanding.length}`)
    }
    if (snapshot.outstanding.length > 4) throw new Error('outstanding size exceeded 4')
    if (snapshot.outstanding.length > snapshot.maxOutstanding) snapshot.maxOutstanding = snapshot.outstanding.length
    return
  }
  if (event.kind === 'halfrow') {
    if (event.phase === 'occupy') {
      if (snapshot.halfRow.includes(event.bank)) throw new Error(`bank ${event.bank} occupied twice`)
      snapshot.halfRow.push(event.bank)
      return
    }
    const index = snapshot.halfRow.indexOf(event.bank)
    if (index < 0) throw new Error(`bank ${event.bank} released without an occupy`)
    snapshot.halfRow.splice(index, 1)
    return
  }
  if (event.kind === 'refresh') {
    snapshot.lockedBank = event.lockedBank
    snapshot.nextEventAt = event.nextEventAt
    if (event.phase === 'busy') {
      snapshot.refreshActive = true
      snapshot.refreshSpans.push({ start: event.tick, end: null, lockedBank: event.lockedBank })
    }
    if (event.phase === 'done') {
      snapshot.refreshActive = false
      const open = snapshot.refreshSpans.find((span) => span.end === null)
      if (open) open.end = event.tick
    }
    return
  }
  const item = requestOf(snapshot, event.id)
  if (event.phase === 'enqueue') {
    if (item.enqueuedAt !== null) throw new Error(`req ${event.id} enqueued twice`)
    item.enqueuedAt = event.at
    return
  }
  if (item.enqueuedAt === null) throw new Error(`req ${event.id} ${event.phase} before enqueue`)
  if (event.phase === 'firstWord') item.firstWordAt = event.at
  else item.completedAt = event.at
}

export function fold(events: readonly TraceEvent[], untilTick: number): Snapshot {
  const header = events[0]
  if (!header || header.kind !== 'sim') throw new Error('trace is missing the sim header')
  const snapshot = emptySnapshot(header)
  for (const event of events) {
    if (event.kind !== 'sim' && event.tick > untilTick) continue
    applyEvent(snapshot, event)
  }
  snapshot.tick = untilTick
  return snapshot
}

export function foldAll(events: readonly TraceEvent[]): Snapshot {
  const header = events[0]
  if (!header || header.kind !== 'sim') throw new Error('trace is missing the sim header')
  return fold(events, header.totalTicks)
}
