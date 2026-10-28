import { pickOpenPage } from '../channel/schedule.ts'
import { isRowHit, tryActivate, tryPrecharge } from '../core/bank.ts'
import { makeCore, replaceBank, stepCore, type DramCore } from '../core/dram.ts'
import { CUPPU_DDR, CUPPU_SDR, deviceSteps } from '../core/params.ts'
import { makeDelay, pushDelay, type DelayFifo } from '../gates/delay.ts'
import { makeDivider, stepDivider, type Divider } from '../gates/divider.ts'
import { emptyPrefetch, loadPair, shiftOut, type Prefetch2 } from './prefetch.ts'

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
  emitted: number
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

export type Device = {
  kind: 'sdr' | 'ddr'
  period: number
  rowSteps: number
  tRpSteps: number
  core: DramCore
  divider: Divider
  column: DelayFifo<Token | undefined>
  pin: PinWord[]
  prefetch: Prefetch2
  peakPrefetch: number
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

function blankTrack(job: MemJob, tick: number): Track {
  return {
    id: job.id,
    enqueuedAt: tick,
    rowStart: null,
    rowEnd: null,
    colStart: null,
    colEnd: null,
    firstWord: null,
    lastWord: null,
    words: job.burst,
    emitted: 0,
    overlap: 0,
    transfer: 0,
    doneAt: null,
  }
}

export function makeDevice(opts: {
  kind: 'sdr' | 'ddr'
  period?: number
  rowSteps?: number
  tRpSteps?: number
  casClocks?: number
  banks?: number
  manual?: boolean
  trace?: boolean
}): Device {
  const defaults = opts.kind === 'sdr' ? CUPPU_SDR : CUPPU_DDR
  const period = opts.period ?? defaults.clock
  const rowSteps = opts.rowSteps ?? deviceSteps(defaults.rowAccess, period)
  const tRpSteps = opts.tRpSteps ?? deviceSteps(defaults.tRp, period)
  const casClocks = opts.casClocks ?? deviceSteps(defaults.colAccess, period)
  return {
    kind: opts.kind,
    period,
    rowSteps,
    tRpSteps,
    core: makeCore(opts.banks ?? defaults.banks),
    divider: makeDivider(period),
    column: makeDelay(casClocks),
    pin: [],
    prefetch: emptyPrefetch(),
    peakPrefetch: 0,
    queue: [],
    tracks: new Map(),
    openings: [],
    tick: 0,
    coreSteps: 0,
    activates: 0,
    beats: [],
    trace: opts.trace ?? false,
    manual: opts.manual ?? false,
  }
}

export function makeSdr(opts?: {
  period?: number
  rowSteps?: number
  tRpSteps?: number
  casClocks?: number
  banks?: number
  manual?: boolean
  trace?: boolean
}): Device {
  return makeDevice({ kind: 'sdr', ...opts })
}

export function makeDdr(opts?: {
  period?: number
  rowSteps?: number
  tRpSteps?: number
  casClocks?: number
  banks?: number
  manual?: boolean
  trace?: boolean
}): Device {
  return makeDevice({ kind: 'ddr', ...opts })
}

export function enqueue(device: Device, job: MemJob): void {
  device.queue.push(job)
  device.tracks.set(job.id, blankTrack(job, device.tick))
}

function shiftColumn(device: Device, token: Token | undefined): void {
  const pushed = pushDelay(device.column, token)
  device.column = pushed.fifo
  if (!pushed.out) return
  const track = device.tracks.get(pushed.out.id)
  if (track && track.colStart !== null) track.colEnd = device.tick
  device.pin.push({ id: pushed.out.id, left: pushed.out.words })
}

function markActive(device: Device): void {
  for (const opening of device.openings) {
    if (opening.end !== null) continue
    const bank = device.core.banks[opening.bank]
    if (bank.state === 'active' && bank.openRow === opening.row) opening.end = device.tick
  }
}

function applyRead(device: Device, id: number, bank: number, row: number, burst: number): void {
  if (!isRowHit(device.core.banks[bank], row)) return
  const track = device.tracks.get(id)
  if (track) {
    track.colStart = device.tick
    const opening = device.openings.find((item) => item.id === id)
    if (opening) {
      track.rowStart = opening.start
      track.rowEnd = opening.end
    }
  }
  shiftColumn(device, { id, words: burst })
  device.queue = device.queue.filter((job) => job.id !== id)
}

function applyManual(device: Device, cmd: ManualCmd | undefined): void {
  if (!cmd || cmd.op === 'nop') {
    shiftColumn(device, undefined)
    return
  }
  if (cmd.op === 'activate') {
    const result = tryActivate(device.core.banks[cmd.bank], cmd.row, device.rowSteps)
    if (!result.blocked && !result.hit) {
      device.core = replaceBank(device.core, cmd.bank, result.bank)
      device.activates += 1
    }
    shiftColumn(device, undefined)
    return
  }
  if (cmd.op === 'precharge') {
    const next = tryPrecharge(device.core.banks[cmd.bank], device.tRpSteps)
    if (next) device.core = replaceBank(device.core, cmd.bank, next)
    shiftColumn(device, undefined)
    return
  }
  applyRead(device, cmd.id, cmd.bank, cmd.row, cmd.burst)
}

function applyAuto(device: Device): void {
  const choice = pickOpenPage(device.queue, device.core.banks)
  if (!choice) {
    shiftColumn(device, undefined)
    return
  }
  if (choice.act === 'read') {
    applyRead(device, choice.job.id, choice.job.bank, choice.job.row, choice.job.burst)
    return
  }
  if (choice.act === 'activate') {
    const result = tryActivate(device.core.banks[choice.job.bank], choice.job.row, device.rowSteps)
    if (!result.blocked && !result.hit) {
      device.core = replaceBank(device.core, choice.job.bank, result.bank)
      device.activates += 1
      device.openings.push({
        id: choice.job.id,
        bank: choice.job.bank,
        row: choice.job.row,
        start: device.tick,
        end: null,
      })
    }
    shiftColumn(device, undefined)
    return
  }
  const next = tryPrecharge(device.core.banks[choice.job.bank], device.tRpSteps)
  if (next) device.core = replaceBank(device.core, choice.job.bank, next)
  shiftColumn(device, undefined)
}

function emitWord(device: Device, id: number, ticksPerWord: number): void {
  const track = device.tracks.get(id)
  if (track) {
    if (track.firstWord === null) track.firstWord = device.tick
    track.lastWord = device.tick
    track.emitted += 1
    track.transfer += ticksPerWord
    if (track.emitted === track.words) track.doneAt = device.tick
  }
  if (device.trace) device.beats.push({ tick: device.tick, id })
}

function takePin(device: Device): number | undefined {
  const head = device.pin[0]
  if (!head) return undefined
  const id = head.id
  head.left -= 1
  if (head.left === 0) device.pin.shift()
  return id
}

function drainSdr(device: Device): void {
  const id = takePin(device)
  if (id === undefined) return
  emitWord(device, id, device.period)
}

function drainDdr(device: Device): void {
  if (device.prefetch.count === 0) {
    const first = takePin(device)
    if (first === undefined) return
    const second = takePin(device)
    device.prefetch = loadPair(device.prefetch, first, second)
  }
  if (device.prefetch.count > device.peakPrefetch) device.peakPrefetch = device.prefetch.count
  const shifted = shiftOut(device.prefetch)
  device.prefetch = shifted.prefetch
  if (shifted.id === undefined) return
  emitWord(device, shifted.id, device.period / 2)
}

function noteOverlap(device: Device): void {
  const pinsBusy = device.pin.length > 0 || device.prefetch.count > 0
  if (!pinsBusy) return
  for (const slot of device.column.slots) {
    if (!slot) continue
    const track = device.tracks.get(slot.id)
    if (track) track.overlap += 1
  }
}

export function stepDevice(device: Device, cmd?: ManualCmd): Device {
  const edge = stepDivider(device.divider)
  device.divider = edge.divider
  if (edge.rising) {
    device.coreSteps += 1
    device.core = stepCore(device.core)
    markActive(device)
    if (device.manual) applyManual(device, cmd)
    else applyAuto(device)
    if (device.kind === 'sdr') drainSdr(device)
    else drainDdr(device)
  } else if (device.kind === 'ddr' && edge.falling) {
    drainDdr(device)
  } else if (cmd && cmd.op !== 'nop') {
    throw new Error('a command is accepted only on a rising edge')
  }
  noteOverlap(device)
  device.tick += 1
  return device
}

export function stepToRising(device: Device, cmd?: ManualCmd): Device {
  while (device.divider.count % device.period !== 0) stepDevice(device)
  return stepDevice(device, cmd)
}

export function isSettled(device: Device): boolean {
  if (device.queue.length > 0) return false
  if (device.pin.length > 0) return false
  if (device.prefetch.count > 0) return false
  if (device.column.slots.some((slot) => slot !== undefined)) return false
  if (device.core.banks.some((bank) => bank.timer > 0)) return false
  return true
}

export function runUntilSettled(device: Device, limit = 200_000): Device {
  let guard = 0
  while (!isSettled(device) && guard < limit) {
    stepDevice(device)
    guard += 1
  }
  if (!isSettled(device)) throw new Error(`${device.kind} run did not settle`)
  return device
}

export const stepSdr = stepDevice
export const stepDdr = stepDevice
