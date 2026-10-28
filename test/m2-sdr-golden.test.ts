import assert from 'node:assert/strict'
import test from 'node:test'
import { enqueue, makeSdr, runUntilSettled, stepSdr, stepToRising } from '../src/wrappers/sdr.ts'

test('CL=2 read puts the first word on the rising edge two clocks later', () => {
  let sdr = makeSdr({
    period: 6,
    rowSteps: 2,
    tRpSteps: 2,
    casClocks: 2,
    banks: 4,
    manual: true,
    trace: true,
  })
  sdr = stepToRising(sdr, { op: 'activate', bank: 0, row: 4 })
  assert.equal(sdr.core.banks[0].state, 'rowActivating')
  assert.equal(sdr.core.banks[0].timer, 2)
  assert.equal(sdr.tick, 1)

  sdr = stepToRising(sdr, { op: 'nop' })
  assert.equal(sdr.core.banks[0].state, 'rowActivating')
  assert.equal(sdr.core.banks[0].timer, 1)
  assert.equal(sdr.tick, 7)

  sdr = stepToRising(sdr, {
    op: 'read',
    id: 7,
    bank: 0,
    row: 4,
    col: 1,
    burst: 4,
  })
  assert.equal(sdr.core.banks[0].state, 'active')
  assert.equal(sdr.core.banks[0].openRow, 4)
  assert.equal(sdr.tick, 13)
  assert.equal(sdr.beats.length, 0)
  const readTick = 12

  sdr = stepToRising(sdr, { op: 'nop' })
  assert.equal(sdr.beats.length, 0)

  sdr = stepToRising(sdr, { op: 'nop' })
  assert.equal(sdr.beats.length, 1)
  assert.equal(sdr.beats[0].tick, readTick + 2 * 6)

  const first = sdr.beats[0].tick
  sdr = stepToRising(sdr, { op: 'nop' })
  sdr = stepToRising(sdr, { op: 'nop' })
  sdr = stepToRising(sdr, { op: 'nop' })
  assert.deepEqual(
    sdr.beats.map((beat) => beat.tick),
    [first, first + 6, first + 12, first + 18],
  )
  for (let tick = first + 1; tick < first + 6; tick += 1) {
    assert.equal(
      sdr.beats.some((beat) => beat.tick === tick),
      false,
    )
  }
})

test('SDR steps the core once per clock, not once per tick', () => {
  let sdr = makeSdr({
    period: 8,
    rowSteps: 3,
    tRpSteps: 2,
    casClocks: 3,
    manual: true,
  })
  for (let i = 0; i < 16; i += 1) stepSdr(sdr)
  assert.equal(sdr.coreSteps, 2)
})

test('a second read to the open row does not activate again', () => {
  const sdr = makeSdr({ period: 8, rowSteps: 3, tRpSteps: 2, casClocks: 3, trace: true })
  enqueue(sdr, { id: 1, bank: 0, row: 2, col: 0, burst: 1 })
  enqueue(sdr, { id: 2, bank: 0, row: 2, col: 1, burst: 1 })
  runUntilSettled(sdr)
  assert.equal(sdr.activates, 1)
  assert.equal(sdr.tracks.get(1)?.doneAt !== null, true)
  assert.equal(sdr.tracks.get(2)?.doneAt !== null, true)
  const first = sdr.tracks.get(2)
  assert.equal(first?.rowStart, null)
})
