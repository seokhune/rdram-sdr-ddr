import { writeCsv } from './csv.ts'
import { pairAddedLatency, runArch, runArchDetailed, type ArchName, type Job, type RunRow } from './run.ts'
import { generate, makeRng } from './workload.ts'

const ARCHS: ArchName[] = ['sdr', 'ddr', 'rdram']
const BURSTS = [1, 2, 4, 8, 16, 32, 64]

function one(id: number, bank: number, row: number, burst: number): Job {
  return { id, bank, row, col: 0, burst }
}

function randomJobs(arch: ArchName, count: number, burst: number, seed: number): Job[] {
  const next = makeRng(seed)
  return Array.from({ length: count }, (_, id) => {
    const logicalBank = next() % 16
    return one(
      id,
      arch === 'rdram' ? logicalBank : logicalBank % 4,
      next() % 64,
      burst,
    )
  })
}

export function collectScenarios(): RunRow[] {
  const rows: RunRow[] = []
  for (const burst of BURSTS) {
    for (const arch of ARCHS) {
      rows.push(
        runArch('burst', arch, [one(1, 0, 0, burst)], 1, 100, { open: { bank: 0, row: 0 } }),
      )
    }
  }
  const hit = generate({
    count: 8,
    seed: 11,
    pattern: 'mixed',
    locality: 100,
    burst: 8,
    banks: 1,
    rows: 4,
    cols: 32,
  })
  const miss = generate({
    count: 8,
    seed: 11,
    pattern: 'random',
    locality: 0,
    burst: 8,
    banks: 16,
    rows: 64,
    cols: 32,
  })
  for (const arch of ARCHS) {
    rows.push(runArch('row-hit', arch, hit, 1, 100))
    rows.push(runArch('row-miss', arch, miss, 1, 0))
    rows.push(runArch('pipeline', arch, hit, 4, 100))
  }
  for (const concurrency of [1, 2, 4, 8]) {
    for (const arch of ARCHS) {
      rows.push(runArch('multi', arch, randomJobs(arch, 32, 1, 7), concurrency, 0))
    }
  }
  for (const burst of [4, 64]) {
    rows.push(
      runArch('parts', 'ddr', [one(1, 0, 0, burst)], 1, 100, { open: { bank: 0, row: 0 } }),
    )
  }
  for (const arch of ARCHS) {
    rows.push(runArch('fixed', arch, [one(1, 0, 5, 1)], 1, 0))
  }
  const horizon = 2_000_000
  for (const arch of ARCHS) {
    const jobs = randomJobs(arch, 2048, 8, 7)
    const off = runArchDetailed('sustain-baseline', arch, jobs, 8, 0, { refresh: 'off', horizon })
    const on = runArchDetailed('sustain-refresh', arch, jobs, 8, 0, { refresh: 'on', horizon })
    pairAddedLatency(off, on)
    rows.push(off.row, on.row)
  }
  const single = Array.from({ length: 160 }, (_, id) => one(id, 0, id % 64, 8))
  const singleOff = runArchDetailed('single-bank-refresh', 'rdram', single, 1, 0, {
    refresh: 'off',
    horizon,
  })
  const singleOn = runArchDetailed('single-bank-refresh', 'rdram', single, 1, 0, {
    refresh: 'on',
    horizon,
  })
  pairAddedLatency(singleOff, singleOn)
  rows.push(singleOn.row)
  return rows
}

export function writeScenarios(file: string): RunRow[] {
  const rows = collectScenarios()
  writeCsv(file, rows)
  return rows
}
