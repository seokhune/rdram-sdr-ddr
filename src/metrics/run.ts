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
}

const PEAK_BYTES_PER_TICK: Record<ArchName, number> = {
  sdr: 1,
  ddr: 2,
  rdram: 2,
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  let sum = 0
  for (const value of values) sum += value
  return Math.floor(sum / values.length)
}

function bandwidth(bytes: number, ticks: number): number {
  if (ticks <= 0) return 0
  return Math.floor((bytes * 800) / ticks)
}

function efficiency(arch: ArchName, bytes: number, ticks: number): number {
  if (ticks <= 0) return 0
  return Math.floor((bytes * 100) / (ticks * PEAK_BYTES_PER_TICK[arch]))
}

function span(start: number | null, end: number | null): number {
  if (start === null || end === null) return 0
  return end - start
}

function fromTracks(
  scenario: string,
  arch: ArchName,
  burst: number,
  locality: number,
  concurrency: number,
  ticks: number,
  tracks: Track[],
): RunRow {
  const bytes = tracks.reduce((sum, track) => sum + track.words * 8, 0)
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
  opts?: { open?: { bank: number; row: number } },
): { ticks: number; tracks: Track[] } {
  const device = arch === 'sdr' ? makeSdr() : makeDdr()
  if (opts?.open) primeRow(device, opts.open.bank, opts.open.row)
  let next = 0
  const live = new Set<number>()
  let guard = 0
  while ((next < jobs.length || live.size > 0) && guard < 500_000) {
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
  return { ticks: finishTick(tracks), tracks }
}

export function runRdram(
  jobs: readonly Job[],
  concurrency: number,
  opts?: { open?: { bank: number; row: number }; headerOctcycles?: number },
): { ticks: number; txns: RdramTxn[] } {
  const rdram = makeRdram({ headerOctcycles: opts?.headerOctcycles ?? 1 })
  if (opts?.open) openRow(rdram, opts.open.bank, opts.open.row)
  const waiting = jobs.slice(0, Math.min(concurrency, jobs.length))
  let next = waiting.length
  let guard = 0
  while (rdram.finished.length < jobs.length && guard < 500_000) {
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
  return { ticks: finishTick(rdram.finished), txns: rdram.finished }
}

export function runArch(
  scenario: string,
  arch: ArchName,
  jobs: readonly Job[],
  concurrency: number,
  locality: number,
  opts?: { open?: { bank: number; row: number } },
): RunRow {
  const burst = jobs[0]?.burst ?? 0
  if (arch === 'rdram') {
    const result = runRdram(jobs, concurrency, opts)
    const bytes = payloadBytes(result.txns)
    return {
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
    }
  }
  const adapted = jobs.map((job) => ({ ...job, bank: job.bank % 4 }))
  const result = runJedec(arch, adapted, concurrency, opts?.open ? { open: { bank: opts.open.bank % 4, row: opts.open.row } } : undefined)
  return fromTracks(scenario, arch, burst, locality, concurrency, result.ticks, result.tracks)
}
