import { COMMAND_TABLE } from '../src/core/commands.ts'
import { makeRng } from '../src/metrics/workload.ts'
import {
  enqueue,
  makeDdr,
  makeSdr,
  primeRow,
  stepDevice,
  type Device,
  type ManualCmd,
  type MemJob,
} from '../src/wrappers/jedec.ts'
import {
  makeRdram,
  openRow,
  pullRequest,
  stepRdram,
  type Rdram,
  type RdramJob,
} from '../src/wrappers/rdram.ts'
import type { ArchName, CmdEvent, TraceEvent, TraceParams } from './schema.ts'
import { fifoIdFor } from './schema.ts'

export type RecordRequest = {
  scenario: string
  seed: number
  arch: ArchName
  burst?: number
  concurrency?: number
  count?: number
  refresh?: 'off' | 'on'
}

type BankSnap = { state: string; openRow: number | null; timer: number }

function span(start: number | null, end: number | null): number {
  if (start === null || end === null) return 0
  return end - start
}

function tokenId(token: { id: number } | undefined): string | null {
  return token ? String(token.id) : null
}

function isRise(period: number, count: number): boolean {
  return count % period === 0
}

function isFall(period: number, count: number): boolean {
  return period % 2 === 0 && count % period === period / 2
}

function banksOf(banks: readonly { state: string; openRow: number | null; timer: number }[]): BankSnap[] {
  return banks.map((bank) => ({ state: bank.state, openRow: bank.openRow, timer: bank.timer }))
}

function occupied(slots: readonly boolean[], count: number): number[] {
  const found: number[] = []
  for (let bank = 0; bank < count; bank += 1) {
    if (slots[bank] && slots[bank + 1]) found.push(bank)
  }
  return found
}

function paramsOf(device: Device | Rdram, burst: number, concurrency: number): TraceParams {
  return {
    banks: device.core.banks.length,
    period: 'period' in device ? device.period : device.divider.period,
    casClocks: device.column.depth,
    burst,
    concurrency,
    refresh: device.refresh.enabled ? 1 : 0,
    refreshInterval: device.refresh.intervalTicks,
    refreshBusy: device.refresh.busyTicks,
    headerOctcycles: 'headerOctcycles' in device ? device.headerOctcycles : 0,
  }
}

function commandFor(state: string): 'ACTIVATE' | 'PRECHARGE' | undefined {
  if (state === 'rowActivating') return 'ACTIVATE'
  if (state === 'precharging') return 'PRECHARGE'
  return undefined
}

function commandEvent(tick: number, bank: number, decoded: CmdEvent['decoded']): CmdEvent {
  return { kind: 'cmd', tick, bank, pins: { ...COMMAND_TABLE[decoded] }, decoded }
}

function seedOpen(
  banks: readonly { state: string; openRow: number | null; timer: number }[],
  halfBanks: readonly number[],
): TraceEvent[] {
  const events: TraceEvent[] = []
  banks.forEach((bank, index) => {
    if (bank.state === 'idle') return
    events.push({
      kind: 'bank',
      tick: 0,
      bank: index,
      from: 'idle',
      to: bank.state,
      openRow: bank.openRow,
      timer: bank.timer,
    })
  })
  for (const bank of halfBanks) events.push({ kind: 'halfrow', tick: 0, bank, phase: 'occupy' })
  return events
}

function diffBanks(tick: number, before: readonly BankSnap[], after: readonly BankSnap[]): TraceEvent[] {
  const events: TraceEvent[] = []
  for (let bank = 0; bank < after.length; bank += 1) {
    const moved = before[bank].state !== after[bank].state
    const counted = before[bank].timer !== after[bank].timer || before[bank].openRow !== after[bank].openRow
    if (!moved && !counted) continue
    events.push({
      kind: 'bank',
      tick,
      bank,
      from: before[bank].state,
      to: after[bank].state,
      openRow: after[bank].openRow,
      timer: after[bank].timer,
    })
    if (!moved) continue
    const decoded = commandFor(after[bank].state)
    if (decoded) events.push(commandEvent(tick, bank, decoded))
  }
  return events
}

function diffColumn(
  tick: number,
  fifoId: string,
  rise: boolean,
  before: readonly ({ id: number } | undefined)[],
  after: readonly ({ id: number } | undefined)[],
): TraceEvent[] {
  if (!rise) return []
  return [
    { kind: 'fifo', tick, fifoId, op: 'pop', token: tokenId(before[0]) },
    { kind: 'fifo', tick, fifoId, op: 'push', token: tokenId(after[after.length - 1]) },
  ]
}

function diffRefresh(
  tick: number,
  mode: 'commodity' | 'bank',
  beforeEvents: number,
  beforeRemaining: number,
  eventsNow: number,
  remaining: number,
  lockedBank: number | null,
  nextEventAt: number,
): TraceEvent[] {
  const out: TraceEvent[] = []
  if (eventsNow !== beforeEvents) {
    out.push({ kind: 'refresh', tick, mode, phase: 'event', lockedBank, nextEventAt })
  }
  if (beforeRemaining === 0 && remaining > 0) {
    out.push({ kind: 'refresh', tick, mode, phase: 'busy', lockedBank, nextEventAt })
  }
  if (beforeRemaining > 0 && remaining === 0) {
    out.push({ kind: 'refresh', tick, mode, phase: 'done', lockedBank, nextEventAt })
  }
  return out
}

export function recordScenario(request: RecordRequest): TraceEvent[] {
  if (request.scenario === 'golden-cl2') return recordGolden(request)
  if (request.arch === 'rdram') return recordRdram(request)
  return recordJedec(request)
}

function jobsFor(request: RecordRequest, burst: number): MemJob[] {
  if (request.scenario === 'burst') return [{ id: 1, bank: 0, row: 0, col: 0, burst }]
  const count = request.count ?? (request.scenario === 'sustain' ? 64 : 8)
  const next = makeRng(request.seed)
  const banks = request.arch === 'rdram' ? 16 : 4
  return Array.from({ length: count }, (_, id) => ({
    id: id + 1,
    bank: (next() % 16) % banks,
    row: next() % 64,
    col: 0,
    burst,
  }))
}

function recordJedec(request: RecordRequest): TraceEvent[] {
  const device = request.arch === 'ddr' ? makeDdr({ refresh: request.refresh === 'on' }) : makeSdr({ refresh: request.refresh === 'on' })
  const burst = request.burst ?? 8
  const concurrency = request.concurrency ?? 1
  const jobs = jobsFor(request, burst)
  if (request.scenario === 'burst') primeRow(device, 0, 0)
  const events: TraceEvent[] = [
    {
      kind: 'sim',
      arch: request.arch,
      scenario: request.scenario,
      seed: request.seed,
      params: paramsOf(device, burst, concurrency),
      totalTicks: 0,
    },
  ]
  events.push(...seedOpen(banksOf(device.core.banks), []))
  const fifoId = fifoIdFor(request.arch)
  let next = 0
  const live = new Set<number>()
  let words = 0
  let guard = 0
  const limit = request.scenario === 'sustain' ? 2_000_000 : 200_000
  while ((next < jobs.length || live.size > 0) && guard < limit) {
    while (live.size < concurrency && next < jobs.length) {
      const job = jobs[next]
      enqueue(device, job)
      events.push({ kind: 'req', tick: device.tick, id: job.id, phase: 'enqueue', at: device.tick })
      live.add(job.id)
      next += 1
    }
    const produced = stepJedec(device, fifoId, words)
    words += produced.filter((event) => event.kind === 'pin').length
    events.push(...produced)
    for (const id of live) {
      if (device.tracks.get(id)?.doneAt !== null) live.delete(id)
    }
    guard += 1
  }
  if (next < jobs.length || live.size > 0) throw new Error(`${request.arch} trace did not finish`)
  const sim = events[0]
  if (sim.kind === 'sim') sim.totalTicks = device.tick
  for (const job of jobs) {
    const track = device.tracks.get(job.id)
    if (!track) continue
    events.push({
      kind: 'reqSummary',
      tick: track.doneAt ?? device.tick,
      id: job.id,
      bank: job.bank,
      row: job.row,
      col: job.col,
      burst: job.burst,
      enqueuedAt: track.enqueuedAt,
      firstWordAt: track.firstWord,
      rowSpan: span(track.rowStart, track.rowEnd),
      colSpan: span(track.colStart, track.colEnd),
      transferSpan: track.transfer,
      overlap: track.overlap,
      completedAt: track.doneAt,
    })
  }
  return events
}

function stepJedec(device: Device, fifoId: string, words: number): TraceEvent[] {
  const beforeBanks = banksOf(device.core.banks)
  const beforeColumn = device.column.slots.slice()
  const beforeQueue = device.queue.map((job) => ({ ...job }))
  const beforeTracks = new Map(
    [...device.tracks].map(([id, track]) => [id, { emitted: track.emitted, firstWord: track.firstWord, doneAt: track.doneAt }]),
  )
  const beforeEvents = device.refresh.events
  const beforeRemaining = device.refresh.remaining
  const rise = isRise(device.period, device.divider.count)
  const edge = rise ? 'rise' : isFall(device.period, device.divider.count) ? 'fall' : undefined
  const tick = device.tick
  stepDevice(device)
  const events: TraceEvent[] = []
  if (edge) events.push({ kind: 'edge', tick, edge })
  events.push(...diffBanks(tick, beforeBanks, banksOf(device.core.banks)))
  for (const job of beforeQueue) {
    if (device.queue.some((item) => item.id === job.id)) continue
    events.push(commandEvent(tick, job.bank, 'READ'))
  }
  events.push(...diffColumn(tick, fifoId, rise, beforeColumn, device.column.slots))
  let word = words
  for (const [id, track] of device.tracks) {
    const prior = beforeTracks.get(id)
    const emitted = prior?.emitted ?? 0
    for (let step = emitted; step < track.emitted; step += 1) {
      events.push({ kind: 'pin', tick, wordIndex: word, reqId: id })
      word += 1
    }
    if ((prior?.firstWord ?? null) === null && track.firstWord !== null) {
      events.push({ kind: 'req', tick, id, phase: 'firstWord', at: track.firstWord })
    }
    if ((prior?.doneAt ?? null) === null && track.doneAt !== null) {
      events.push({ kind: 'req', tick, id, phase: 'complete', at: track.doneAt })
    }
  }
  events.push(
    ...diffRefresh(
      tick,
      'commodity',
      beforeEvents,
      beforeRemaining,
      device.refresh.events,
      device.refresh.remaining,
      device.refresh.lockedBank,
      device.refresh.nextEventAt,
    ),
  )
  return events
}

function recordRdram(request: RecordRequest): TraceEvent[] {
  const device = makeRdram({ refresh: request.refresh === 'on' })
  const burst = request.burst ?? 8
  const concurrency = request.concurrency ?? 1
  const jobs = jobsFor(request, burst)
  if (request.scenario === 'burst') openRow(device, 0, 0)
  const events: TraceEvent[] = [
    {
      kind: 'sim',
      arch: 'rdram',
      scenario: request.scenario,
      seed: request.seed,
      params: paramsOf(device, burst, concurrency),
      totalTicks: 0,
    },
  ]
  events.push(...seedOpen(banksOf(device.core.banks), occupied(device.halfRow.slots, device.core.banks.length)))
  const waiting: RdramJob[] = jobs.slice(0, Math.min(concurrency, jobs.length))
  let next = waiting.length
  let guard = 0
  const announced = new Set<number>()
  const wordsOut = new Map<number, number>()
  const limit = request.scenario === 'sustain' ? 2_000_000 : 200_000
  while (device.finished.length < jobs.length && guard < limit) {
    while (device.outstanding.byId.size < concurrency && waiting.length > 0) {
      const sizeBefore = waiting.length
      if (!pullRequest(device, waiting)) break
      if (waiting.length === sizeBefore) break
      const accepted = jobs.find((job) => device.outstanding.byId.has(job.id) && !announced.has(job.id))
      if (!accepted) continue
      announced.add(accepted.id)
      const txn = device.outstanding.byId.get(accepted.id)
      events.push({ kind: 'req', tick: device.tick, id: accepted.id, phase: 'enqueue', at: txn?.enqueuedAt ?? device.tick })
      events.push({
        kind: 'outstanding',
        tick: device.tick,
        txnId: accepted.id,
        phase: 'track',
        size: device.outstanding.byId.size,
      })
    }
    while (waiting.length < concurrency && next < jobs.length) {
      waiting.push(jobs[next])
      next += 1
    }
    events.push(...stepRdramObserved(device, wordsOut))
    guard += 1
  }
  if (device.finished.length < jobs.length) throw new Error('rdram trace did not finish')
  const sim = events[0]
  if (sim.kind === 'sim') sim.totalTicks = device.tick
  for (const job of jobs) {
    const txn = device.finished.find((item) => item.id === job.id)
    if (!txn) continue
    events.push({
      kind: 'reqSummary',
      tick: txn.doneAt ?? device.tick,
      id: job.id,
      bank: job.bank,
      row: job.row,
      col: job.col,
      burst: job.burst,
      enqueuedAt: txn.enqueuedAt,
      firstWordAt: txn.firstWord,
      rowSpan: span(txn.rowStart, txn.rowEnd),
      colSpan: span(txn.colStart, txn.colEnd),
      transferSpan: txn.transfer,
      overlap: txn.overlap,
      completedAt: txn.doneAt,
    })
  }
  return events
}

function stepRdramObserved(device: Rdram, wordsOut: Map<number, number>): TraceEvent[] {
  const beforeBanks = banksOf(device.core.banks)
  const beforeColumn = device.column.slots.slice()
  const beforeIds = new Set(device.outstanding.byId.keys())
  const beforeFirst = new Map([...device.outstanding.byId].map(([id, txn]) => [id, txn.firstWord]))
  const beforeFinished = device.finished.length
  const beforeChannel = device.channel
  const beforeHalf = occupied(device.halfRow.slots, device.core.banks.length)
  const beforeEvents = device.refresh.events
  const beforeRemaining = device.refresh.remaining
  const rise = isRise(device.divider.period, device.divider.count)
  const edge = rise ? 'rise' : isFall(device.divider.period, device.divider.count) ? 'fall' : undefined
  const tick = device.tick
  stepRdram(device)
  const events: TraceEvent[] = []
  if (edge) events.push({ kind: 'edge', tick, edge })
  events.push(...diffBanks(tick, beforeBanks, banksOf(device.core.banks)))
  events.push(...diffColumn(tick, 'rdram.colPipe', rise, beforeColumn, device.column.slots))
  const afterHalf = occupied(device.halfRow.slots, device.core.banks.length)
  for (const bank of afterHalf) {
    if (!beforeHalf.includes(bank)) events.push({ kind: 'halfrow', tick, bank, phase: 'occupy' })
  }
  for (const bank of beforeHalf) {
    if (!afterHalf.includes(bank)) events.push({ kind: 'halfrow', tick, bank, phase: 'release' })
  }
  if (beforeChannel.mode === 'idle' && device.channel.mode !== 'idle') {
    const seg = device.channel.mode === 'header' ? device.channel.which : 'DATA'
    events.push({ kind: 'chan', tick, txnId: device.channel.id, seg, phase: 'begin' })
  } else if (beforeChannel.mode !== 'idle' && device.channel.mode === 'idle') {
    const seg = beforeChannel.mode === 'header' ? beforeChannel.which : 'DATA'
    events.push({ kind: 'chan', tick, txnId: beforeChannel.id, seg, phase: 'end' })
    if (beforeChannel.mode === 'data') {
      const txn =
        device.outstanding.byId.get(beforeChannel.id) ?? device.finished.find((item) => item.id === beforeChannel.id)
      const sent = wordsOut.get(beforeChannel.id) ?? 0
      const add = Math.min(2, (txn?.burst ?? 0) - sent)
      for (let word = 0; word < add; word += 1) {
        events.push({ kind: 'pin', tick, wordIndex: sent + word, reqId: beforeChannel.id })
      }
      wordsOut.set(beforeChannel.id, sent + add)
    }
  }
  if (device.finished.length > beforeFinished) {
    for (const txn of device.finished.slice(beforeFinished)) {
      events.push({ kind: 'outstanding', tick, txnId: txn.id, phase: 'complete', size: device.outstanding.byId.size })
      if (beforeFirst.get(txn.id) == null && txn.firstWord !== null) {
        events.push({ kind: 'req', tick, id: txn.id, phase: 'firstWord', at: txn.firstWord })
      }
      events.push({ kind: 'req', tick, id: txn.id, phase: 'complete', at: txn.doneAt ?? tick })
    }
  }
  for (const [id, txn] of device.outstanding.byId) {
    if (beforeIds.has(id)) {
      if (beforeFirst.get(id) == null && txn.firstWord !== null) {
        events.push({ kind: 'req', tick, id, phase: 'firstWord', at: txn.firstWord })
      }
      continue
    }
    events.push({ kind: 'outstanding', tick, txnId: id, phase: 'track', size: device.outstanding.byId.size })
  }
  events.push(
    ...diffRefresh(
      tick,
      'bank',
      beforeEvents,
      beforeRemaining,
      device.refresh.events,
      device.refresh.remaining,
      device.refresh.lockedBank,
      device.refresh.nextEventAt,
    ),
  )
  return events
}

function recordGolden(request: RecordRequest): TraceEvent[] {
  const device = makeSdr({
    period: 6,
    rowSteps: 2,
    tRpSteps: 2,
    casClocks: 2,
    banks: 4,
    manual: true,
    trace: true,
  })
  const events: TraceEvent[] = [
    {
      kind: 'sim',
      arch: 'sdr',
      scenario: 'golden-cl2',
      seed: request.seed,
      params: {
        banks: 4,
        period: 6,
        casClocks: 2,
        burst: 4,
        concurrency: 1,
        refresh: 0,
        refreshInterval: device.refresh.intervalTicks,
        refreshBusy: device.refresh.busyTicks,
        headerOctcycles: 0,
      },
      totalTicks: 0,
    },
  ]
  const commands: ManualCmd[] = [
    { op: 'activate', bank: 0, row: 4 },
    { op: 'nop' },
    { op: 'read', id: 7, bank: 0, row: 4, col: 1, burst: 4 },
    { op: 'nop' },
    { op: 'nop' },
    { op: 'nop' },
    { op: 'nop' },
    { op: 'nop' },
  ]
  let command = 0
  let words = 0
  let guard = 0
  while (words < 4 && guard < 5_000) {
    const rise = isRise(device.period, device.divider.count)
    const cmd = rise && command < commands.length ? commands[command] : undefined
    if (rise && command < commands.length) command += 1
    const beforeBanks = banksOf(device.core.banks)
    const beforeColumn = device.column.slots.slice()
    const beforeBeats = device.beats.length
    const tick = device.tick
    const edge = rise ? 'rise' : isFall(device.period, device.divider.count) ? 'fall' : undefined
    stepDevice(device, cmd)
    if (edge) events.push({ kind: 'edge', tick, edge })
    events.push(...diffBanks(tick, beforeBanks, banksOf(device.core.banks)))
    if (cmd?.op === 'read') events.push(commandEvent(tick, cmd.bank, 'READ'))
    events.push(...diffColumn(tick, 'jedec.cl', rise, beforeColumn, device.column.slots))
    for (const beat of device.beats.slice(beforeBeats)) {
      events.push({ kind: 'pin', tick: beat.tick, wordIndex: words, reqId: beat.id })
      words += 1
    }
    guard += 1
  }
  const sim = events[0]
  if (sim.kind === 'sim') sim.totalTicks = device.tick
  return events
}
