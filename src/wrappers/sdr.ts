import { pickOpenPage } from '../channel/schedule.ts'
import { isRowHit, tryActivate, tryPrecharge } from '../core/bank.ts'
import { makeCore, replaceBank, stepCore, type DramCore } from '../core/dram.ts'
import { CUPPU_CLOCK, CUPPU_COL_ACCESS, CUPPU_ROW_ACCESS, CUPPU_T_RP, deviceSteps } from '../core/params.ts'
import { makeDelay, pushDelay, type DelayFifo } from '../gates/delay.ts'
import { makeDivider, stepDivider, type Divider } from '../gates/divider.ts'

export type MemJob = {
  id: number
  bank: number
  row: number
  col: number
  burst: number
}

export type Track = {
  id: number
  enqueuedAt: number
  rowStart: number | null
  rowEnd: number | null
  colStart: number | null
  colEnd: number | null
  firstWord: number | null
  lastWord: number | null
  words: number
  overlap: number
  transfer: number
  doneAt: number | null
}

type Token = { id: number; words: number }
type PinWord = { id: number; left: number }
type Opening = { id: number; bank: number; row: number; start: number; end: number | null }

export type ManualCmd =
  | { op: 'nop' }
  | { op: 'activate'; bank: number; row: number }
  | { op: 'precharge'; bank: number }
  | { op: 'read'; id: number; bank: number; row: number; col: number; burst: number }

export type Sdr = {
  period: number
  rowSteps: number
  tRpSteps: number
  core: DramCore
  divider: Divider
  column: DelayFifo<Token | undefined>
  pin: PinWord[]
  queue: MemJob[]
  tracks: Map<number, Track>
  openings: Opening[]
  tick: number
  coreSteps: number
  activates: number
  beats: Array<{ tick: number; id: number }>
  trace: boolean
  manual: boolean
}

export function makeSdr(opts?: {
  period?: number
  rowSteps?: number
  tRpSteps?: number
  casClocks?: number
  banks?: number
  manual?: boolean
  trace?: boolean
}): Sdr {
  const period = opts?.period ?? CUPPU_CLOCK.sdr
  const rowSteps = opts?.rowSteps ?? deviceSteps(CUPPU_ROW_ACCESS.sdr, period)
  const tRpSteps = opts?.tRpSteps ?? deviceSteps(CUPPU_T_RP.sdr, period)
  const casClocks = opts?.casClocks ?? deviceSteps(CUPPU_COL_ACCESS.sdr, period)
  return {
    period,
    rowSteps,
    tRpSteps,
    core: makeCore(opts?.banks ?? 4),
    divider: makeDivider(period),
    column: makeDelay(casClocks),
    pin: [],
    queue: [],
    tracks: new Map(),
    openings: [],
    tick: 0,
    coreSteps: 0,
    activates: 0,
    beats: [],
    trace: opts?.trace ?? false,
    manual: opts?.manual ?? false,
  }
}

export function enqueue(sdr: Sdr, job: MemJob): void {
  sdr.queue.push(job)
  sdr.tracks.set(job.id, {
    id: job.id,
    enqueuedAt: sdr.tick,
    rowStart: null,
    rowEnd: null,
    colStart: null,
    colEnd: null,
    firstWord: null,
    lastWord: null,
    words: job.burst,
    overlap: 0,
    transfer: 0,
    doneAt: null,
  })
}

function shiftColumn(sdr: Sdr, token: Token | undefined): void {
  const pushed = pushDelay(sdr.column, token)
  sdr.column = pushed.fifo
  if (!pushed.out) return
  const track = sdr.tracks.get(pushed.out.id)
  if (track && track.colStart !== null) track.colEnd = sdr.tick
  sdr.pin.push({ id: pushed.out.id, left: pushed.out.words })
}

function markActive(sdr: Sdr): void {
  for (const opening of sdr.openings) {
    if (opening.end !== null) continue
    const bank = sdr.core.banks[opening.bank]
    if (bank.state === 'active' && bank.openRow === opening.row) opening.end = sdr.tick
  }
}

function applyRead(sdr: Sdr, id: number, bank: number, row: number, burst: number): void {
  if (!isRowHit(sdr.core.banks[bank], row)) return
  const track = sdr.tracks.get(id)
  if (track) {
    track.colStart = sdr.tick
    const opening = sdr.openings.find((item) => item.id === id)
    if (opening) {
      track.rowStart = opening.start
      track.rowEnd = opening.end
    }
  }
  shiftColumn(sdr, { id, words: burst })
  sdr.queue = sdr.queue.filter((job) => job.id !== id)
}

function applyManual(sdr: Sdr, cmd: ManualCmd | undefined): void {
  const tokenShift = cmd?.op === 'read' ? undefined : undefined
  if (!cmd || cmd.op === 'nop') {
    shiftColumn(sdr, undefined)
    return
  }
  if (cmd.op === 'activate') {
    const result = tryActivate(sdr.core.banks[cmd.bank], cmd.row, sdr.rowSteps)
    if (!result.blocked && !result.hit) {
      sdr.core = replaceBank(sdr.core, cmd.bank, result.bank)
      sdr.activates += 1
    }
    shiftColumn(sdr, tokenShift)
    return
  }
  if (cmd.op === 'precharge') {
    const next = tryPrecharge(sdr.core.banks[cmd.bank], sdr.tRpSteps)
    if (next) sdr.core = replaceBank(sdr.core, cmd.bank, next)
    shiftColumn(sdr, undefined)
    return
  }
  applyRead(sdr, cmd.id, cmd.bank, cmd.row, cmd.burst)
}

function applyAuto(sdr: Sdr): void {
  const choice = pickOpenPage(sdr.queue, sdr.core.banks)
  if (!choice) {
    shiftColumn(sdr, undefined)
    return
  }
  if (choice.act === 'read') {
    applyRead(sdr, choice.job.id, choice.job.bank, choice.job.row, choice.job.burst)
    return
  }
  if (choice.act === 'activate') {
    const result = tryActivate(sdr.core.banks[choice.job.bank], choice.job.row, sdr.rowSteps)
    if (!result.blocked && !result.hit) {
      sdr.core = replaceBank(sdr.core, choice.job.bank, result.bank)
      sdr.activates += 1
      sdr.openings.push({
        id: choice.job.id,
        bank: choice.job.bank,
        row: choice.job.row,
        start: sdr.tick,
        end: null,
      })
    }
    shiftColumn(sdr, undefined)
    return
  }
  const next = tryPrecharge(sdr.core.banks[choice.job.bank], sdr.tRpSteps)
  if (next) sdr.core = replaceBank(sdr.core, choice.job.bank, next)
  shiftColumn(sdr, undefined)
}

function drainRising(sdr: Sdr): void {
  const head = sdr.pin[0]
  if (!head || head.left <= 0) return
  head.left -= 1
  const track = sdr.tracks.get(head.id)
  if (track) {
    if (track.firstWord === null) track.firstWord = sdr.tick
    track.lastWord = sdr.tick
    track.transfer += sdr.period
  }
  if (sdr.trace) sdr.beats.push({ tick: sdr.tick, id: head.id })
  if (head.left === 0) {
    if (track) track.doneAt = sdr.tick
    sdr.pin.shift()
  }
}

function noteOverlap(sdr: Sdr): void {
  if (sdr.pin.length === 0) return
  for (const slot of sdr.column.slots) {
    if (!slot) continue
    const track = sdr.tracks.get(slot.id)
    if (track) track.overlap += 1
  }
}

export function stepSdr(sdr: Sdr, cmd?: ManualCmd): Sdr {
  const edge = stepDivider(sdr.divider)
  sdr.divider = edge.divider
  if (edge.rising) {
    sdr.coreSteps += 1
    sdr.core = stepCore(sdr.core)
    markActive(sdr)
    if (sdr.manual) applyManual(sdr, cmd)
    else applyAuto(sdr)
    drainRising(sdr)
  } else if (cmd && cmd.op !== 'nop') {
    throw new Error('SDR accepts a command only on a rising edge')
  }
  noteOverlap(sdr)
  sdr.tick += 1
  return sdr
}

export function stepToRising(sdr: Sdr, cmd?: ManualCmd): Sdr {
  while (sdr.divider.count % sdr.period !== 0) stepSdr(sdr)
  return stepSdr(sdr, cmd)
}

export function isSettled(sdr: Sdr): boolean {
  if (sdr.queue.length > 0) return false
  if (sdr.pin.length > 0) return false
  if (sdr.column.slots.some((slot) => slot !== undefined)) return false
  if (sdr.core.banks.some((bank) => bank.timer > 0)) return false
  return true
}

export function runUntilSettled(sdr: Sdr, limit = 200_000): Sdr {
  let guard = 0
  while (!isSettled(sdr) && guard < limit) {
    stepSdr(sdr)
    guard += 1
  }
  if (!isSettled(sdr)) throw new Error('SDR run did not settle')
  return sdr
}
