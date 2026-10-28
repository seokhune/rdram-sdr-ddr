import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { toCsv } from '../src/metrics/csv.ts'
import { collectScenarios } from '../src/metrics/scenarios.ts'
import type { ArchName, RunRow } from '../src/metrics/run.ts'

const rows = collectScenarios()
const OLD = new Set(['burst', 'row-hit', 'row-miss', 'pipeline', 'multi', 'parts', 'fixed'])

function pick(scenario: string, arch: ArchName): RunRow {
  const found = rows.find((row) => row.scenario === scenario && row.arch === arch)
  assert.ok(found, `${scenario} ${arch}`)
  return found
}

test('existing scenario columns keep the M5 values', () => {
  const fixture = readFileSync('test/fixtures/m5-scenarios.csv', 'utf8').trim().split(/\r?\n/)
  const header = fixture[0].split(',')
  const fresh = toCsv(rows.filter((row) => OLD.has(row.scenario))).trim().split(/\r?\n/)
  assert.equal(fresh.length, fixture.length)
  for (let line = 0; line < fixture.length; line += 1) {
    const expected = fixture[line].split(',')
    const actual = fresh[line].split(',').slice(0, header.length)
    assert.deepEqual(actual, expected, `line ${line}`)
  }
})

test('a saturated burst keeps moving data through a refresh', () => {
  for (const arch of ['sdr', 'ddr', 'rdram'] as const) {
    const off = pick('sustain-baseline', arch)
    const on = pick('sustain-refresh', arch)
    assert.equal(off.refresh, 0)
    assert.equal(off.refreshEvents, 0)
    assert.equal(on.refresh, 1)
    assert.ok(on.refreshEvents > 0, arch)
    assert.equal(on.bytes, off.bytes)
    assert.ok(on.ticks >= off.ticks, arch)
  }
  const ddr = pick('sustain-refresh', 'ddr')
  const rdram = pick('sustain-refresh', 'rdram')
  assert.ok(ddr.refreshAddedLatencyMax > 0)
  assert.ok(rdram.refreshAddedLatencyMax < ddr.refreshAddedLatencyMax)
})

test('one RDRAM bank refresh adds at most one row refresh of wait', () => {
  const row = pick('single-bank-refresh', 'rdram')
  assert.equal(row.refresh, 1)
  assert.ok(row.refreshEvents > 0)
  assert.ok(row.refreshAddedLatencyMax > 0)
  assert.ok(row.refreshAddedLatencyMax <= 30)
})
