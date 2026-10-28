import { dropTrack, makeOutstanding, tryTrack, type OutTable } from '../channel/outstanding.ts'
import { isRowHit, tryActivate, tryPrecharge, type Bank } from '../core/bank.ts'
import { makeCore, replaceBank, stepCore, type DramCore } from '../core/dram.ts'
import {
  CUPPU_RDRAM,
  HALF_ROW_SLOTS,
  OCTCYCLE_TICKS,
  RAMBUS_REFRESH_INTERVAL_TICKS,
  deviceSteps,
  refreshBusyTicks,
} from '../core/params.ts'
import { makeRefresh, refreshBlocksBank, tickRefresh, type RefreshScheduler } from '../core/refresh.ts'
import { canActivate, makeHalfRow, occupy, release, slotPair, type HalfRow } from '../core/halfRow.ts'
import { makeDelay, pushDelay, type DelayFifo } from '../gates/delay.ts'
import { makeDivider, stepDivider, type Divider } from '../gates/divider.ts'

export type RdramJob = {
  id: number
  bank: number
  row: number
  col: number
  burst: number
}

type Stage =
  | 'needRow'
  | 'rowHeader'
  | 'actPending'
  | 'activating'
  | 'needPre'
  | 'precharging'
  | 'waitBank'
  | 'needCol'
  | 'colHeader'
  | 'colPending'
  | 'inColumn'
  | 'ready'
  | 'data'

export type RdramTxn = {
  id: number
  bank: number
  row: number
  col: number
  burst: number
  stage: Stage
  enqueuedAt: number
  rowStart: number | null
  rowEnd: number | null
  colStart: number | null
  colEnd: number | null
  firstWord: number | null
  lastWord: number | null
  overlap: number
  transfer: number
  chunksLeft: number
  doneAt: number | null
}

type Channel =
  | { mode: 'idle' }
  | { mode: 'header'; left: number; id: number; which: 'ROW' | 'COL'; start: number }
  | { mode: 'data'; left: number; id: number; start: number }

export type Occupation = {
  id: number
  kind: 'ROW' | 'COL' | 'DATA'
  start: number
  end: number
}

type Token = { id: number }

export type Rdram = {
  core: DramCore
  halfRow: HalfRow
  divider: Divider
  column: DelayFifo<Token | undefined>
  outstanding: OutTable<RdramTxn>
  channel: Channel
  finished: RdramTxn[]
  occupations: Occupation[]
  tick: number
  coreSteps: number
  activates: number
  headerOctcycles: number
  rowSteps: number
  tRpSteps: number
  channelIdle: number
  headerBusy: number
  dataBusy: number
  onDone: Map<number, (txn: RdramTxn) => void>
  refresh: RefreshScheduler
}

export function makeRdram(opts?: {
  headerOctcycles?: number
  rowSteps?: number
  tRpSteps?: number
  casClocks?: number
  onDone?: (txn: RdramTxn) => void
  refresh?: boolean
  refreshInterval?: number
  refreshBusy?: number
}): Rdram {
  const headerOctcycles = opts?.headerOctcycles ?? 1
  if (!Number.isInteger(headerOctcycles) || headerOctcycles < 1) {
    throw new Error('headerOctcycles must be an integer >= 1')
  }
  const rowSteps = opts?.rowSteps ?? deviceSteps(CUPPU_RDRAM.rowAccess, CUPPU_RDRAM.clock)
  const tRpSteps = opts?.tRpSteps ?? deviceSteps(CUPPU_RDRAM.tRp, CUPPU_RDRAM.clock)
  const casClocks = opts?.casClocks ?? deviceSteps(CUPPU_RDRAM.colAccess, CUPPU_RDRAM.clock)
  return {
    core: makeCore(CUPPU_RDRAM.banks),
    halfRow: makeHalfRow(HALF_ROW_SLOTS),
    divider: makeDivider(CUPPU_RDRAM.clock),
    column: makeDelay(casClocks),
    outstanding: makeOutstanding(4),
    channel: { mode: 'idle' },
    finished: [],
    occupations: [],
    tick: 0,
    coreSteps: 0,
    activates: 0,
    headerOctcycles,
    rowSteps,
    tRpSteps,
    channelIdle: 0,
    headerBusy: 0,
    dataBusy: 0,
    onDone: new Map(),
    refresh: makeRefresh({
      enabled: opts?.refresh ?? false,
      intervalTicks: opts?.refreshInterval ?? RAMBUS_REFRESH_INTERVAL_TICKS,
      busyTicks: opts?.refreshBusy ?? refreshBusyTicks('rdram'),
      mode: 'bank',
      bankCount: CUPPU_RDRAM.banks,
    }),
  }
}

export function openRow(rdram: Rdram, bank: number, row: number): void {
  const held = occupy(rdram.halfRow, bank)
  if (!held) throw new Error(`bank ${bank} cannot open`)
  rdram.halfRow = held
  rdram.core.banks[bank] = { state: 'active', openRow: row, timer: 0 }
}

function blankTxn(job: RdramJob, tick: number, stage: Stage): RdramTxn {
  return {
    id: job.id,
    bank: job.bank,
    row: job.row,
    col: job.col,
    burst: job.burst,
    stage,
    enqueuedAt: tick,
    rowStart: null,
    rowEnd: null,
    colStart: null,
    colEnd: null,
    firstWord: null,
    lastWord: null,
    overlap: 0,
    transfer: 0,
    chunksLeft: 0,
    doneAt: null,
  }
}

function initialStage(rdram: Rdram, job: RdramJob): Stage {
  const bank = rdram.core.banks[job.bank]
  if (isRowHit(bank, job.row)) return 'needCol'
  if (bank.state === 'active') return 'needPre'
  if (bank.state === 'idle') return 'needRow'
  return 'waitBank'
}

export function pullRequest(rdram: Rdram, queue: RdramJob[]): boolean {
  if (rdram.outstanding.byId.size >= rdram.outstanding.max) return false
  let fallback = -1
  for (let index = 0; index < queue.length; index += 1) {
    const job = queue[index]
    const bank = rdram.core.banks[job.bank]
    if (isRowHit(bank, job.row)) {
      const [picked] = queue.splice(index, 1)
      return accept(rdram, picked)
    }
    if (fallback < 0) fallback = index
    if (bank.state === 'idle' && canActivate(rdram.halfRow, job.bank)) {
      const [picked] = queue.splice(index, 1)
      return accept(rdram, picked)
    }
  }
  if (fallback < 0) return false
  const [picked] = queue.splice(fallback, 1)
  return accept(rdram, picked)
}

export function accept(rdram: Rdram, job: RdramJob, onDone?: (txn: RdramTxn) => void): boolean {
  const txn = blankTxn(job, rdram.tick, initialStage(rdram, job))
  if (!tryTrack(rdram.outstanding, job.id, txn)) return false
  if (onDone) rdram.onDone.set(job.id, onDone)
  return true
}

function txns(rdram: Rdram): RdramTxn[] {
  return [...rdram.outstanding.byId.values()]
}

function finish(rdram: Rdram, txn: RdramTxn): void {
  txn.doneAt = rdram.tick
  txn.lastWord = rdram.tick
  rdram.finished.push(txn)
  dropTrack(rdram.outstanding, txn.id)
  const callback = rdram.onDone.get(txn.id)
  rdram.onDone.delete(txn.id)
  callback?.(txn)
}

function closeOccupation(rdram: Rdram): void {
  const channel = rdram.channel
  if (channel.mode === 'idle') return
  const kind = channel.mode === 'data' ? 'DATA' : channel.which
  rdram.occupations.push({ id: channel.id, kind, start: channel.start, end: rdram.tick })
}

function completeChannel(rdram: Rdram): void {
  const channel = rdram.channel
  closeOccupation(rdram)
  if (channel.mode === 'header') {
    const txn = rdram.outstanding.byId.get(channel.id)
    if (txn) txn.stage = channel.which === 'ROW' ? 'actPending' : 'colPending'
  }
  if (channel.mode === 'data') {
    const txn = rdram.outstanding.byId.get(channel.id)
    if (txn) {
      txn.lastWord = rdram.tick
      if (txn.chunksLeft === 0) finish(rdram, txn)
      else txn.stage = 'ready'
    }
  }
  rdram.channel = { mode: 'idle' }
}

function startHeader(rdram: Rdram, txn: RdramTxn, which: 'ROW' | 'COL'): void {
  const left = rdram.headerOctcycles * OCTCYCLE_TICKS
  rdram.channel = { mode: 'header', left, id: txn.id, which, start: rdram.tick }
  txn.stage = which === 'ROW' ? 'rowHeader' : 'colHeader'
}

function bankLocked(rdram: Rdram, bank: number): boolean {
  return refreshBlocksBank(rdram.refresh, bank)
}

function tryAssign(rdram: Rdram): boolean {
  for (const txn of txns(rdram)) {
    if (txn.stage === 'ready' && txn.chunksLeft > 0) {
      txn.chunksLeft -= 1
      txn.stage = 'data'
      if (txn.firstWord === null) txn.firstWord = rdram.tick
      rdram.channel = { mode: 'data', left: OCTCYCLE_TICKS, id: txn.id, start: rdram.tick }
      return true
    }
  }
  for (const txn of txns(rdram)) {
    if (txn.stage === 'needCol' && isRowHit(rdram.core.banks[txn.bank], txn.row)) {
      if (bankLocked(rdram, txn.bank)) continue
      startHeader(rdram, txn, 'COL')
      return true
    }
  }
  for (const txn of txns(rdram)) {
    if (txn.stage !== 'needRow') continue
    if (bankLocked(rdram, txn.bank)) continue
    if (rdram.core.banks[txn.bank].state !== 'idle') continue
    if (!canActivate(rdram.halfRow, txn.bank)) continue
    startHeader(rdram, txn, 'ROW')
    return true
  }
  return false
}

function prechargeBank(rdram: Rdram, bankIndex: number): boolean {
  const next = tryPrecharge(rdram.core.banks[bankIndex], rdram.tRpSteps)
  if (!next) return false
  rdram.core = replaceBank(rdram.core, bankIndex, next)
  rdram.halfRow = release(rdram.halfRow, bankIndex)
  for (const txn of txns(rdram)) {
    if (txn.bank === bankIndex && txn.stage === 'needCol') txn.stage = 'needPre'
    if (txn.bank === bankIndex && txn.stage === 'needPre') txn.stage = 'precharging'
  }
  return true
}

function unblockNeighbor(rdram: Rdram): void {
  for (const txn of txns(rdram)) {
    if (txn.stage !== 'needRow') continue
    if (canActivate(rdram.halfRow, txn.bank)) continue
    const [left, right] = slotPair(txn.bank)
    for (let other = 0; other < rdram.core.banks.length; other += 1) {
      if (other === txn.bank) continue
      const holdsLeft = other === left || other + 1 === left
      const holdsRight = other === right || other + 1 === right
      if (!holdsLeft && !holdsRight) continue
      const bank = rdram.core.banks[other]
      if (bank.state !== 'active') continue
      if (txns(rdram).some((held) => held.bank === other)) continue
      if (bankLocked(rdram, other)) continue
      if (prechargeBank(rdram, other)) return
    }
  }
}

function onCore(rdram: Rdram): void {
  rdram.core = stepCore(rdram.core)
  rdram.coreSteps += 1
  for (const txn of txns(rdram)) {
    const bank: Bank = rdram.core.banks[txn.bank]
    if ((txn.stage === 'precharging' || txn.stage === 'waitBank') && bank.state === 'idle') {
      txn.stage = 'needRow'
    }
    if (txn.stage === 'activating' && bank.state === 'active' && bank.openRow === txn.row) {
      txn.rowEnd = rdram.tick
      txn.stage = 'needCol'
    }
    if ((txn.stage === 'needRow' || txn.stage === 'waitBank') && bank.state === 'active') {
      txn.stage = bank.openRow === txn.row ? 'needCol' : 'needPre'
    }
  }
  for (const txn of txns(rdram)) {
    if (txn.stage !== 'actPending') continue
    if (bankLocked(rdram, txn.bank)) continue
    if (rdram.core.banks[txn.bank].state !== 'idle') continue
    if (!canActivate(rdram.halfRow, txn.bank)) continue
    const held = occupy(rdram.halfRow, txn.bank)
    if (!held) continue
    const result = tryActivate(rdram.core.banks[txn.bank], txn.row, rdram.rowSteps)
    if (result.blocked || result.hit) continue
    rdram.halfRow = held
    rdram.core = replaceBank(rdram.core, txn.bank, result.bank)
    rdram.activates += 1
    txn.stage = 'activating'
    txn.rowStart = rdram.tick
    break
  }
  for (const txn of txns(rdram)) {
    if (txn.stage !== 'needPre') continue
    if (bankLocked(rdram, txn.bank)) continue
    const bank = rdram.core.banks[txn.bank]
    if (bank.state !== 'active' || bank.openRow === txn.row) continue
    const busy = txns(rdram).some(
      (other) => other.bank === txn.bank && other.id !== txn.id && other.stage !== 'needPre',
    )
    if (busy) continue
    if (prechargeBank(rdram, txn.bank)) break
  }
  unblockNeighbor(rdram)
  let token: Token | undefined
  for (const txn of txns(rdram)) {
    if (txn.stage !== 'colPending') continue
    if (bankLocked(rdram, txn.bank)) continue
    if (!isRowHit(rdram.core.banks[txn.bank], txn.row)) continue
    token = { id: txn.id }
    txn.stage = 'inColumn'
    txn.colStart = rdram.tick
    break
  }
  const pushed = pushDelay(rdram.column, token)
  rdram.column = pushed.fifo
  if (!pushed.out) return
  const done = rdram.outstanding.byId.get(pushed.out.id)
  if (!done) return
  done.colEnd = rdram.tick
  done.chunksLeft = Math.ceil(done.burst / 2)
  done.stage = 'ready'
}

function noteOverlap(rdram: Rdram): void {
  if (rdram.channel.mode !== 'data') return
  for (const slot of rdram.column.slots) {
    if (!slot) continue
    const txn = rdram.outstanding.byId.get(slot.id)
    if (txn) txn.overlap += 1
  }
}

export function stepRdram(rdram: Rdram): Rdram {
  const edge = stepDivider(rdram.divider)
  rdram.divider = edge.divider
  if (edge.rising) onCore(rdram)
  if (rdram.channel.mode === 'idle') tryAssign(rdram)
  if (rdram.channel.mode === 'idle') rdram.channelIdle += 1
  else {
    if (rdram.channel.mode === 'header') rdram.headerBusy += 1
    else rdram.dataBusy += 1
    rdram.channel.left -= 1
    if (rdram.channel.left === 0) completeChannel(rdram)
  }
  noteOverlap(rdram)
  rdram.tick += 1
  rdram.refresh = tickRefresh(rdram.refresh, rdram.tick)
  return rdram
}

export function isSettled(rdram: Rdram): boolean {
  if (rdram.outstanding.byId.size > 0) return false
  if (rdram.channel.mode !== 'idle') return false
  if (rdram.column.slots.some((slot) => slot !== undefined)) return false
  return true
}

export function runUntilSettled(rdram: Rdram, limit = 200_000): Rdram {
  let guard = 0
  while (!isSettled(rdram) && guard < limit) {
    stepRdram(rdram)
    guard += 1
  }
  if (!isSettled(rdram)) {
    const stages = txns(rdram)
      .map((txn) => `${txn.id}:${txn.stage}@b${txn.bank}`)
      .join(', ')
    throw new Error(`RDRAM run did not settle (${stages || 'no txn'}, channel ${rdram.channel.mode})`)
  }
  return rdram
}

export function payloadBytes(txnsFinished: readonly RdramTxn[]): number {
  return txnsFinished.reduce((sum, txn) => sum + txn.burst * 8, 0)
}
