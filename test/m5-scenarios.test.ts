import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { writeScenarios } from '../src/metrics/scenarios.ts'
import type { ArchName, RunRow } from '../src/metrics/run.ts'
import { generate } from '../src/metrics/workload.ts'

const rows = writeScenarios('metrics/out/scenarios.csv')

function pick(scenario: string, arch: ArchName, extra?: (row: RunRow) => boolean): RunRow {
  const found = rows.find(
    (row) => row.scenario === scenario && row.arch === arch && (extra?.(row) ?? true),
  )
  assert.ok(found, `${scenario} ${arch}`)
  return found
}

test('the workload generator is deterministic for a seed', () => {
  const opts = {
    count: 20,
    seed: 99,
    pattern: 'random' as const,
    locality: 30,
    burst: 4,
    banks: 16,
    rows: 32,
    cols: 8,
  }
  assert.deepEqual(generate(opts), generate(opts))
  assert.notDeepEqual(generate(opts), generate({ ...opts, seed: 100 }))
})

test('RDRAM efficiency rises with burst and the later gains shrink', () => {
  const efficiency = [1, 2, 4, 8, 16, 32, 64].map(
    (burst) => pick('burst', 'rdram', (row) => row.burst === burst).efficiency,
  )
  for (let index = 1; index < efficiency.length; index += 1) {
    assert.ok(efficiency[index] > efficiency[index - 1])
  }
  const early = efficiency[3] - efficiency[0]
  const late = efficiency[6] - efficiency[3]
  assert.ok(late < early)
})

test('an open page is faster than a miss, and pipelined column access overlaps transfer', () => {
  for (const arch of ['sdr', 'ddr', 'rdram'] as const) {
    const hit = pick('row-hit', arch)
    const miss = pick('row-miss', arch)
    const piped = pick('pipeline', arch)
    assert.ok(hit.avgLatency < miss.avgLatency)
    assert.ok(piped.maxOverlap > 0)
  }
})

test('DDR leads both the open-page stream and the miss stream', () => {
  function leader(scenario: string): ArchName {
    const group = rows.filter((row) => row.scenario === scenario)
    group.sort((a, b) => a.avgLatency - b.avgLatency)
    return group[0].arch
  }
  assert.equal(leader('row-hit'), 'ddr')
  assert.equal(leader('row-miss'), 'ddr')
})

test('more concurrent requests raise bandwidth, and one RDRAM read is slower than DDR', () => {
  for (const arch of ['sdr', 'ddr', 'rdram'] as const) {
    const low = pick('multi', arch, (row) => row.concurrency === 1)
    const high = pick('multi', arch, (row) => row.concurrency === 4)
    assert.ok(high.bandwidthMBps > low.bandwidthMBps)
  }
  const fixedDdr = pick('fixed', 'ddr')
  const fixedRdram = pick('fixed', 'rdram')
  assert.ok(fixedRdram.avgFirst > fixedDdr.avgFirst)
})

test('a longer DDR burst raises bandwidth and leaves the fixed delay unchanged', () => {
  const short = pick('parts', 'ddr', (row) => row.burst === 4)
  const long = pick('parts', 'ddr', (row) => row.burst === 64)
  assert.ok(long.bandwidthMBps > short.bandwidthMBps)
  assert.equal(long.avgFirst, short.avgFirst)
  assert.equal(long.avgColumn, short.avgColumn)
  assert.equal(short.avgRow, 0)
})

test('the scenario CSV is written', () => {
  const text = readFileSync('metrics/out/scenarios.csv', 'utf8')
  assert.ok(text.startsWith('scenario,arch,burst,'))
  assert.ok(text.includes('rdram'))
})
