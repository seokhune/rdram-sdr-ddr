/*
  시나리오를 틱 루프가 끝날 때까지 돌리고, 대역폭과 지연을 셉니다.
  대역폭은 미리 적은 상수가 아닙니다. 옮긴 바이트와 끝난 틱으로 계산합니다.
  1틱이 1.25ns이므로, 틱당 1바이트는 초당 800MB입니다.
  바이트 × 800 / 틱 의 내림이 MB/s입니다.
  최고 속도는 SDR이 틱당 1바이트(800MB/s), DDR과 RDRAM이 틱당 2바이트(1600MB/s)입니다.
*/

import { stepDevice, primeRow, enqueue, makeDdr, makeSdr, type MemJob, type Track } from '../wrappers/jedec.ts'
import {
  makeRdram,
  openRow,
  payloadBytes,
  pullRequest,
  stepRdram,
  type RdramTxn,
} from '../wrappers/rdram.ts'

export type ArchName = 'sdr' | 'ddr' | 'rdram'

export type Job = MemJob

export type RunRow = {
  scenario: string
  arch: ArchName
  burst: number
  locality: number
  concurrency: number
  ticks: number
  bytes: number
  bandwidthMBps: number
  avgLatency: number
  avgFirst: number
  avgRow: number
  avgColumn: number
  avgTransfer: number
  avgOverlap: number
  maxOverlap: number
  efficiency: number
  refresh: number
  refreshEvents: number
  refreshBusyTicks: number
  latP50: number
  latP99: number
  latMax: number
  refreshAddedLatencyAvg: number
  refreshAddedLatencyMax: number
}

export type LatencySample = {
  id: number
  latency: number
}

type RunOpts = {
  open?: { bank: number; row: number }
  refresh?: 'off' | 'on'
  refreshInterval?: number
  horizon?: number
  headerOctcycles?: number
}

const PEAK_BYTES_PER_TICK: Record<ArchName, number> = {
  sdr: 1,
  ddr: 2,
  rdram: 2,
}

/* 평균의 내림. 빈 목록은 0입니다. */
function mean(values: number[]): number {
  if (values.length === 0) return 0
  let sum = 0
  for (const value of values) sum += value
  return Math.floor(sum / values.length)
}

/*
슈도코드
mean(값들):
  비어 있으면 0
  합을 개수로 나눈 내림을 반환
*/

/* 옮긴 바이트와 걸린 틱으로 MB/s를 냅니다. 틱당 1바이트가 800MB/s입니다. */
function bandwidth(bytes: number, ticks: number): number {
  if (ticks <= 0) return 0
  return Math.floor((bytes * 800) / ticks)
}

/*
슈도코드
bandwidth(바이트, 틱):
  틱이 0 이하면 0
  반환 내림(바이트 × 800 / 틱)
*/

/* 최고 속도 대비 백분율의 내림. SDR 분모는 틱×1, DDR과 RDRAM 분모는 틱×2입니다. */
function efficiency(arch: ArchName, bytes: number, ticks: number): number {
  if (ticks <= 0) return 0
  return Math.floor((bytes * 100) / (ticks * PEAK_BYTES_PER_TICK[arch]))
}

/*
슈도코드
efficiency(방식, 바이트, 틱):
  틱이 0 이하면 0
  최고 = SDR이면 1, DDR과 RDRAM이면 2
  반환 내림(바이트 × 100 / (틱 × 최고))
*/

function span(start: number | null, end: number | null): number {
  if (start === null || end === null) return 0
  return end - start
}

function percentile(sorted: number[], percent: number): number {
  if (sorted.length === 0) return 0
  const rank = Math.ceil((percent / 100) * sorted.length) - 1
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))]
}

function latencyOf(doneAt: number | null, enqueuedAt: number, ticks: number): number {
  return (doneAt ?? ticks) - enqueuedAt
}

function refreshColumns(
  latencies: number[],
  refreshOn: boolean,
  events: number,
  busyTicks: number,
): Pick<
  RunRow,
  | 'refresh'
  | 'refreshEvents'
  | 'refreshBusyTicks'
  | 'latP50'
  | 'latP99'
  | 'latMax'
  | 'refreshAddedLatencyAvg'
  | 'refreshAddedLatencyMax'
> {
  const sorted = [...latencies].sort((left, right) => left - right)
  return {
    refresh: refreshOn ? 1 : 0,
    refreshEvents: events,
    refreshBusyTicks: busyTicks,
    latP50: percentile(sorted, 50),
    latP99: percentile(sorted, 99),
    latMax: sorted.length === 0 ? 0 : sorted[sorted.length - 1],
    refreshAddedLatencyAvg: 0,
    refreshAddedLatencyMax: 0,
  }
}

function fromTracks(
  scenario: string,
  arch: ArchName,
  burst: number,
  locality: number,
  concurrency: number,
  ticks: number,
  tracks: Track[],
  refreshOn: boolean,
  refreshEvents: number,
  refreshBusyTicks: number,
): RunRow {
  const bytes = tracks.reduce((sum, track) => sum + track.words * 8, 0)
  const latencies = tracks.map((track) => latencyOf(track.doneAt, track.enqueuedAt, ticks))
  return {
    scenario,
    arch,
    burst,
    locality,
    concurrency,
    ticks,
    bytes,
    bandwidthMBps: bandwidth(bytes, ticks),
    avgLatency: mean(tracks.map((track) => track.doneAt ?? ticks)),
    avgFirst: mean(tracks.map((track) => track.firstWord ?? ticks)),
    avgRow: mean(tracks.map((track) => span(track.rowStart, track.rowEnd))),
    avgColumn: mean(tracks.map((track) => span(track.colStart, track.colEnd))),
    avgTransfer: mean(tracks.map((track) => track.transfer)),
    avgOverlap: mean(tracks.map((track) => track.overlap)),
    maxOverlap: tracks.reduce((max, track) => Math.max(max, track.overlap), 0),
    efficiency: efficiency(arch, bytes, ticks),
    ...refreshColumns(latencies, refreshOn, refreshEvents, refreshBusyTicks),
  }
}

function finishTick(tracks: { doneAt: number | null }[]): number {
  let end = 0
  for (const track of tracks) end = Math.max(end, track.doneAt ?? 0)
  return end
}

export function runJedec(
  arch: 'sdr' | 'ddr',
  jobs: readonly Job[],
  concurrency: number,
  opts?: RunOpts,
): { ticks: number; tracks: Track[]; refreshEvents: number; refreshBusyTicks: number } {
  const device = arch === 'sdr' ? makeSdr({ refresh: opts?.refresh === 'on' }) : makeDdr({ refresh: opts?.refresh === 'on' })
  if (opts?.open) primeRow(device, opts.open.bank, opts.open.row)
  let next = 0
  const live = new Set<number>()
  let guard = 0
  const limit = opts?.horizon ?? 500_000
  while ((next < jobs.length || live.size > 0) && guard < limit) {
    while (live.size < concurrency && next < jobs.length) {
      enqueue(device, jobs[next])
      live.add(jobs[next].id)
      next += 1
    }
    stepDevice(device)
    for (const id of live) {
      const track = device.tracks.get(id)
      if (track?.doneAt !== null) live.delete(id)
    }
    guard += 1
  }
  if (next < jobs.length || live.size > 0) throw new Error(`${arch} scenario did not finish`)
  const tracks = jobs.map((job) => device.tracks.get(job.id)).filter((track): track is Track => !!track)
  return {
    ticks: finishTick(tracks),
    tracks,
    refreshEvents: device.refresh.events,
    refreshBusyTicks: device.refresh.busyTicksTotal,
  }
}

export function runRdram(
  jobs: readonly Job[],
  concurrency: number,
  opts?: RunOpts,
): { ticks: number; txns: RdramTxn[]; refreshEvents: number; refreshBusyTicks: number } {
  const rdram = makeRdram({
    headerOctcycles: opts?.headerOctcycles ?? 1,
    refresh: opts?.refresh === 'on',
    refreshInterval: opts?.refreshInterval,
  })
  if (opts?.open) openRow(rdram, opts.open.bank, opts.open.row)
  const waiting = jobs.slice(0, Math.min(concurrency, jobs.length))
  let next = waiting.length
  let guard = 0
  const limit = opts?.horizon ?? 500_000
  while (rdram.finished.length < jobs.length && guard < limit) {
    while (rdram.outstanding.byId.size < concurrency && waiting.length > 0) {
      if (!pullRequest(rdram, waiting)) break
    }
    while (waiting.length < concurrency && next < jobs.length) {
      waiting.push(jobs[next])
      next += 1
    }
    stepRdram(rdram)
    guard += 1
  }
  if (rdram.finished.length < jobs.length) {
    const stuck = [...rdram.outstanding.byId.values()]
      .map((txn) => `${txn.id}:${txn.stage}@b${txn.bank}r${txn.row}`)
      .join(', ')
    throw new Error(
      `rdram scenario did not finish (${rdram.finished.length}/${jobs.length}; ${stuck}; channel ${rdram.channel.mode})`,
    )
  }
  return {
    ticks: finishTick(rdram.finished),
    txns: rdram.finished,
    refreshEvents: rdram.refresh.events,
    refreshBusyTicks: rdram.refresh.busyTicksTotal,
  }
}

export type ArchRun = {
  row: RunRow
  samples: LatencySample[]
}

export function runArchDetailed(
  scenario: string,
  arch: ArchName,
  jobs: readonly Job[],
  concurrency: number,
  locality: number,
  opts?: RunOpts,
): ArchRun {
  const burst = jobs[0]?.burst ?? 0
  const refreshOn = opts?.refresh === 'on'
  if (arch === 'rdram') {
    const result = runRdram(jobs, concurrency, opts)
    const bytes = payloadBytes(result.txns)
    const latencies = result.txns.map((txn) => latencyOf(txn.doneAt, txn.enqueuedAt, result.ticks))
    return {
      row: {
        scenario,
        arch,
        burst,
        locality,
        concurrency,
        ticks: result.ticks,
        bytes,
        bandwidthMBps: bandwidth(bytes, result.ticks),
        avgLatency: mean(result.txns.map((txn) => txn.doneAt ?? result.ticks)),
        avgFirst: mean(result.txns.map((txn) => txn.firstWord ?? result.ticks)),
        avgRow: mean(result.txns.map((txn) => span(txn.rowStart, txn.rowEnd))),
        avgColumn: mean(result.txns.map((txn) => span(txn.colStart, txn.colEnd))),
        avgTransfer: mean(result.txns.map((txn) => txn.transfer)),
        avgOverlap: mean(result.txns.map((txn) => txn.overlap)),
        maxOverlap: result.txns.reduce((max, txn) => Math.max(max, txn.overlap), 0),
        efficiency: efficiency(arch, bytes, result.ticks),
        ...refreshColumns(latencies, refreshOn, result.refreshEvents, result.refreshBusyTicks),
      },
      samples: result.txns.map((txn) => ({
        id: txn.id,
        latency: latencyOf(txn.doneAt, txn.enqueuedAt, result.ticks),
      })),
    }
  }
  const adapted = jobs.map((job) => ({ ...job, bank: job.bank % 4 }))
  const result = runJedec(arch, adapted, concurrency, {
    open: opts?.open ? { bank: opts.open.bank % 4, row: opts.open.row } : undefined,
    refresh: opts?.refresh,
    horizon: opts?.horizon,
  })
  return {
    row: fromTracks(
      scenario,
      arch,
      burst,
      locality,
      concurrency,
      result.ticks,
      result.tracks,
      refreshOn,
      result.refreshEvents,
      result.refreshBusyTicks,
    ),
    samples: result.tracks.map((track) => ({
      id: track.id,
      latency: latencyOf(track.doneAt, track.enqueuedAt, result.ticks),
    })),
  }
}

export function pairAddedLatency(off: ArchRun, on: ArchRun): void {
  const baseline = new Map(off.samples.map((sample) => [sample.id, sample.latency]))
  const deltas: number[] = []
  for (const sample of on.samples) {
    const prior = baseline.get(sample.id)
    if (prior === undefined) continue
    deltas.push(sample.latency - prior)
  }
  const avg = mean(deltas)
  let max = deltas.length === 0 ? 0 : deltas[0]
  for (const delta of deltas) max = Math.max(max, delta)
  on.row.refreshAddedLatencyAvg = avg
  on.row.refreshAddedLatencyMax = max
}

export function runArch(
  scenario: string,
  arch: ArchName,
  jobs: readonly Job[],
  concurrency: number,
  locality: number,
  opts?: RunOpts,
): RunRow {
  return runArchDetailed(scenario, arch, jobs, concurrency, locality, opts).row
}
