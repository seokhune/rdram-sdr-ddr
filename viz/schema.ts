export type ArchName = 'sdr' | 'ddr' | 'rdram'

export type CommandName =
  | 'ACTIVATE'
  | 'READ'
  | 'WRITE'
  | 'PRECHARGE'
  | 'REFRESH'
  | 'MRS'

export type TraceParams = {
  banks: number
  period: number
  casClocks: number
  burst: number
  concurrency: number
  refresh: number
  refreshInterval: number
  refreshBusy: number
  headerOctcycles: number
}

export type SimEvent = {
  kind: 'sim'
  arch: ArchName
  scenario: string
  seed: number
  params: TraceParams
  totalTicks: number
}

export type EdgeEvent = { kind: 'edge'; tick: number; edge: 'rise' | 'fall' }

export type CmdEvent = {
  kind: 'cmd'
  tick: number
  bank: number
  pins: { cs: 0 | 1; ras: 0 | 1; cas: 0 | 1; we: 0 | 1 }
  decoded: CommandName
}

export type BankEvent = {
  kind: 'bank'
  tick: number
  bank: number
  from: string
  to: string
  openRow: number | null
  timer: number
}

export type FifoEvent = {
  kind: 'fifo'
  tick: number
  fifoId: string
  op: 'push' | 'pop'
  token: string | null
}

export type PinEvent = { kind: 'pin'; tick: number; wordIndex: number; reqId: number }

export type ChanEvent = {
  kind: 'chan'
  tick: number
  txnId: number
  seg: 'ROW' | 'COL' | 'DATA'
  phase: 'begin' | 'end'
}

export type OutstandingEvent = {
  kind: 'outstanding'
  tick: number
  txnId: number
  phase: 'track' | 'complete'
  size: number
}

export type HalfRowEvent = {
  kind: 'halfrow'
  tick: number
  bank: number
  phase: 'occupy' | 'release'
}

export type RefreshEvent = {
  kind: 'refresh'
  tick: number
  mode: 'commodity' | 'bank'
  phase: 'event' | 'busy' | 'done'
  lockedBank: number | null
  nextEventAt: number
}

export type ReqEvent = {
  kind: 'req'
  tick: number
  id: number
  phase: 'enqueue' | 'firstWord' | 'complete'
  at: number
}

export type ReqSummary = {
  kind: 'reqSummary'
  tick: number
  id: number
  bank: number
  row: number
  col: number
  burst: number
  enqueuedAt: number
  firstWordAt: number | null
  rowSpan: number
  colSpan: number
  transferSpan: number
  overlap: number
  completedAt: number | null
}

export type TraceEvent =
  | SimEvent
  | EdgeEvent
  | CmdEvent
  | BankEvent
  | FifoEvent
  | PinEvent
  | ChanEvent
  | OutstandingEvent
  | HalfRowEvent
  | RefreshEvent
  | ReqEvent
  | ReqSummary

export function fifoIdFor(arch: ArchName): string {
  return arch === 'rdram' ? 'rdram.colPipe' : 'jedec.cl'
}
