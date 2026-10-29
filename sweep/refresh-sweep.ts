// Refresh-interval sensitivity sweep (±50%) for the sustain and single-bank scenarios.
// Replicates src/metrics/scenarios.ts exactly: same jobs, seeds, horizon.
import { runArchDetailed, pairAddedLatency, type Job } from '../src/metrics/run.ts'
import { makeRng } from '../src/metrics/workload.ts'

const horizon = 2_000_000

function one(id: number, bank: number, row: number, burst: number): Job {
  return { id, bank, row, col: 0, burst }
}

// identical to scenarios.ts randomJobs(arch, 2048, 8, 7) for rdram
function sustainJobs(): Job[] {
  const next = makeRng(7)
  return Array.from({ length: 2048 }, (_, id) => {
    const logicalBank = next() % 16
    return one(id, logicalBank, next() % 64, 8)
  })
}

function singleBankJobs(): Job[] {
  return Array.from({ length: 160 }, (_, id) => one(id, 0, id % 64, 8))
}

const INTERVALS = [781, 1_562, 2_343] // 0.5x, 1.0x (paper default), 1.5x of floor(32ms/16,384)

function fmt(row: any) {
  return [
    row.scenario, row.arch, 'interval', row.interval,
    'ticks', row.ticks, 'MBps', row.bandwidthMBps, 'eff', row.efficiency,
    'events', row.refreshEvents, 'busy', row.refreshBusyTicks,
    'addAvg', row.refreshAddedLatencyAvg, 'addMax', row.refreshAddedLatencyMax,
    'p50', row.latP50, 'p99', row.latP99, 'max', row.latMax,
  ].join('\t')
}

const CSV_HEADER = 'scenario,arch,burst,locality,concurrency,ticks,bytes,bandwidthMBps,avgLatency,avgFirst,avgRow,avgColumn,avgTransfer,avgOverlap,maxOverlap,efficiency,refresh,refreshEvents,refreshBusyTicks,latP50,latP99,latMax,refreshAddedLatencyAvg,refreshAddedLatencyMax'
function csvLine(row: any, interval: number, tag: string): string {
  const r = row
  return [tag, r.arch, r.burst, r.locality, r.concurrency, r.ticks, r.bytes, r.bandwidthMBps,
    r.avgLatency, r.avgFirst, r.avgRow, r.avgColumn, r.avgTransfer, r.avgOverlap, r.maxOverlap, r.efficiency, r.refresh,
    r.refreshEvents, r.refreshBusyTicks, r.latP50, r.latP99, r.latMax, r.refreshAddedLatencyAvg, r.refreshAddedLatencyMax].join(',')
}

const csv: string[] = [CSV_HEADER]
const out: string[] = []

// --- 1. baseline reproduction check (interval 1562 must equal repo CSV) ---
{
  const jobs = sustainJobs()
  const off = runArchDetailed('sustain-baseline', 'rdram', jobs, 8, 0, { refresh: 'off', horizon })
  const on = runArchDetailed('sustain-refresh', 'rdram', jobs, 8, 0, { refresh: 'on', horizon }) // default 1562
  pairAddedLatency(off, on)
  out.push('BASELINE-REPRO sustain rdram off:\t' + off.row.ticks + '\t' + off.row.bandwidthMBps)
  out.push('BASELINE-REPRO sustain rdram on(1562):\t' + on.row.ticks + '\t' + on.row.bandwidthMBps + '\t' + on.row.refreshEvents + '\t' + on.row.refreshBusyTicks)
  out.push('BASELINE-REPRO sustain rdram added:\t' + on.row.refreshAddedLatencyAvg + '\t' + on.row.refreshAddedLatencyMax)
  const sOff = runArchDetailed('single-bank-refresh', 'rdram', singleBankJobs(), 1, 0, { refresh: 'off', horizon })
  const sOn = runArchDetailed('single-bank-refresh', 'rdram', singleBankJobs(), 1, 0, { refresh: 'on', horizon })
  pairAddedLatency(sOff, sOn)
  out.push('BASELINE-REPRO single-bank rdram on(1562):\t' + sOn.row.ticks + '\t' + sOn.row.refreshEvents + '\t' + sOn.row.refreshBusyTicks + '\taddMax ' + sOn.row.refreshAddedLatencyMax)
}

// --- 2. sustain sweep ---
for (const interval of INTERVALS) {
  const jobs = sustainJobs()
  const off = runArchDetailed('sustain-baseline', 'rdram', jobs, 8, 0, { refresh: 'off', horizon })
  const on = runArchDetailed('sustain-refresh', 'rdram', jobs, 8, 0, { refresh: 'on', refreshInterval: interval, horizon })
  pairAddedLatency(off, on)
  on.row.interval = interval
  out.push(fmt(on.row))
  if (interval !== 1562) csv.push(csvLine(on.row, interval, interval === 781 ? 'sustain-refresh-r50' : 'sustain-refresh-r150'))
}

// --- 3. single-bank sweep (160 sequential jobs, bank 0) ---
for (const interval of INTERVALS) {
  const jobs = singleBankJobs()
  const off = runArchDetailed('single-bank-off', 'rdram', jobs, 1, 0, { refresh: 'off', horizon })
  const on = runArchDetailed('single-bank-refresh', 'rdram', jobs, 1, 0, { refresh: 'on', refreshInterval: interval, horizon })
  pairAddedLatency(off, on)
  on.row.interval = interval
  out.push(fmt(on.row))
  if (interval !== 1562) csv.push(csvLine(on.row, interval, interval === 781 ? 'single-bank-refresh-r50' : 'single-bank-refresh-r150'))
}

// --- 4. wider probe (out of ±50% range, robustness check only) ---
for (const interval of [391, 195]) {
  const jobs = sustainJobs()
  const off = runArchDetailed('sustain-baseline', 'rdram', jobs, 8, 0, { refresh: 'off', horizon })
  try {
    const on = runArchDetailed('sustain-refresh', 'rdram', jobs, 8, 0, { refresh: 'on', refreshInterval: interval, horizon })
    pairAddedLatency(off, on)
    on.row.interval = interval
    out.push(fmt(on.row))
  } catch (e) {
    out.push(`sustain rdram interval ${interval}: DID NOT FINISH — ${(e as Error).message.split(';')[0]}`)
  }
}

console.log(out.join('\n'))
console.log('===== SWEEP CSV (r50/r150 rows, repo 24-col format) =====')
console.log(csv.join('\n'))
