import assert from 'node:assert/strict'
import test from 'node:test'
import { OCTCYCLE_TICKS } from '../src/core/params.ts'
import { canActivate } from '../src/core/halfRow.ts'
import { accept, makeRdram, openRow, runUntilSettled, stepRdram } from '../src/wrappers/rdram.ts'

function job(id: number, bank: number, row: number, burst = 1) {
  return { id, bank, row, col: 0, burst }
}

test('a packet header occupies headerOctcycles octcycles of the channel', () => {
  const headerOctcycles = 2
  const rdram = makeRdram({ headerOctcycles })
  assert.equal(accept(rdram, job(1, 0, 3)), true)
  runUntilSettled(rdram)
  const row = rdram.occupations.find((item) => item.kind === 'ROW')
  const col = rdram.occupations.find((item) => item.kind === 'COL')
  assert.ok(row)
  assert.ok(col)
  assert.equal(row.end - row.start + 1, headerOctcycles * OCTCYCLE_TICKS)
  assert.equal(col.end - col.start + 1, headerOctcycles * OCTCYCLE_TICKS)
  assert.ok(rdram.headerBusy > 0)
})

test('the device tracks at most four outstanding transactions', () => {
  const rdram = makeRdram({ headerOctcycles: 1 })
  for (let id = 0; id < 4; id += 1) {
    assert.equal(accept(rdram, job(id, id * 2, 1)), true)
  }
  assert.equal(rdram.outstanding.byId.size, 4)
  assert.equal(accept(rdram, job(4, 8, 1)), false)
  while (rdram.outstanding.byId.size === 4) stepRdram(rdram)
  assert.equal(accept(rdram, job(4, 8, 1)), true)
  runUntilSettled(rdram)
  assert.equal(rdram.finished.length, 5)
})

test('channel occupations do not overlap', () => {
  const rdram = makeRdram({ headerOctcycles: 1, casClocks: 1 })
  openRow(rdram, 0, 4)
  openRow(rdram, 2, 4)
  assert.equal(accept(rdram, job(1, 0, 4, 16)), true)
  assert.equal(accept(rdram, job(2, 2, 4, 1)), true)
  runUntilSettled(rdram)
  const spans = rdram.occupations
  for (let i = 0; i < spans.length; i += 1) {
    for (let j = i + 1; j < spans.length; j += 1) {
      const left = spans[i]
      const right = spans[j]
      const disjoint = left.end < right.start || right.end < left.start
      assert.equal(disjoint, true)
    }
  }
  assert.ok(spans.some((span) => span.kind === 'COL'))
  assert.ok(spans.some((span) => span.kind === 'DATA'))
})

test('precharge releases the half-row so the neighbor can activate', () => {
  const rdram = makeRdram({ headerOctcycles: 1 })
  openRow(rdram, 0, 1)
  assert.equal(canActivate(rdram.halfRow, 1), false)
  assert.equal(accept(rdram, job(1, 0, 9)), true)
  assert.equal(accept(rdram, job(2, 1, 3)), true)
  runUntilSettled(rdram)
  assert.equal(rdram.finished.length, 2)
  assert.equal(
    rdram.finished.some((txn) => txn.id === 2 && txn.rowStart !== null),
    true,
  )
})

test('a later row hit can finish before an earlier row miss', () => {
  const done: number[] = []
  const rdram = makeRdram({ headerOctcycles: 1 })
  openRow(rdram, 2, 5)
  assert.equal(
    accept(rdram, job(1, 0, 1), (txn) => done.push(txn.id)),
    true,
  )
  assert.equal(
    accept(rdram, job(2, 2, 5), (txn) => done.push(txn.id)),
    true,
  )
  runUntilSettled(rdram)
  assert.deepEqual(done, [2, 1])
})
