import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyPrefetch, loadPair, shiftOut } from '../src/wrappers/prefetch.ts'
import { enqueue, makeDdr, makeSdr, runUntilSettled, stepDevice, stepToRising } from '../src/wrappers/jedec.ts'

test('prefetch stays a 2-deep register', () => {
  let prefetch = emptyPrefetch()
  assert.equal(prefetch.buf.length, 2)
  for (let i = 0; i < 40; i += 1) {
    prefetch = loadPair(prefetch, i, i + 100)
    assert.equal(prefetch.buf.length, 2)
    assert.ok(prefetch.count <= 2)
    const first = shiftOut(prefetch)
    prefetch = first.prefetch
    const second = shiftOut(prefetch)
    prefetch = second.prefetch
    assert.equal(prefetch.buf.length, 2)
    assert.equal(prefetch.count, 0)
    assert.equal(first.id, i)
    assert.equal(second.id, i + 100)
  }
})

test('DDR data beats are twice as dense as SDR and the prefetch depth stays 2', () => {
  const burst = 64
  const sdr = makeSdr({
    period: 8,
    rowSteps: 2,
    tRpSteps: 2,
    casClocks: 2,
    trace: true,
  })
  const ddr = makeDdr({
    period: 8,
    rowSteps: 2,
    tRpSteps: 2,
    casClocks: 2,
    trace: true,
  })
  enqueue(sdr, { id: 1, bank: 0, row: 3, col: 0, burst })
  enqueue(ddr, { id: 1, bank: 0, row: 3, col: 0, burst })
  runUntilSettled(sdr)
  runUntilSettled(ddr)
  assert.equal(sdr.beats.length, burst)
  assert.equal(ddr.beats.length, burst)
  const sdrSpan = sdr.beats[burst - 1].tick - sdr.beats[0].tick
  const ddrSpan = ddr.beats[burst - 1].tick - ddr.beats[0].tick
  assert.equal(sdrSpan, 2 * ddrSpan)
  assert.equal(ddr.prefetch.buf.length, 2)
  assert.ok(ddr.peakPrefetch <= 2)
  assert.equal(sdr.beats[0].tick, ddr.beats[0].tick)
  for (let i = 1; i < burst; i += 1) {
    assert.equal(sdr.beats[i].tick - sdr.beats[i - 1].tick, 8)
    assert.equal(ddr.beats[i].tick - ddr.beats[i - 1].tick, 4)
  }
})

test('DDR CL=2 emits the later words on every edge', () => {
  let ddr = makeDdr({
    period: 6,
    rowSteps: 2,
    tRpSteps: 2,
    casClocks: 2,
    manual: true,
    trace: true,
  })
  ddr = stepToRising(ddr, { op: 'activate', bank: 0, row: 4 })
  ddr = stepToRising(ddr, { op: 'nop' })
  ddr = stepToRising(ddr, { op: 'read', id: 1, bank: 0, row: 4, col: 0, burst: 4 })
  ddr = stepToRising(ddr, { op: 'nop' })
  ddr = stepToRising(ddr, { op: 'nop' })
  assert.equal(ddr.beats[0]?.tick, 24)
  while (ddr.beats.length < 4) stepDevice(ddr)
  assert.deepEqual(
    ddr.beats.map((beat) => beat.tick),
    [24, 27, 30, 33],
  )
  assert.equal(ddr.prefetch.buf.length, 2)
})
