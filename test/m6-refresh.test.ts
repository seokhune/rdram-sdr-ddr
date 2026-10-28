import assert from 'node:assert/strict'
import test from 'node:test'
import { makeRefresh, refreshBlocksAll, tickRefresh } from '../src/core/refresh.ts'
import { runJedec } from '../src/metrics/run.ts'
import { enqueue, makeSdr, primeRow, stepDevice } from '../src/wrappers/jedec.ts'
import { accept, makeRdram, openRow, runUntilSettled, stepRdram } from '../src/wrappers/rdram.ts'

test('a refresh event starts on each interval and releases after busyTicks', () => {
  const interval = 10
  const busy = 4
  const horizon = 44
  let scheduler = makeRefresh({
    enabled: true,
    intervalTicks: interval,
    busyTicks: busy,
    mode: 'commodity',
    bankCount: 4,
  })
  let streak = 0
  for (let tick = 1; tick <= horizon; tick += 1) {
    scheduler = tickRefresh(scheduler, tick)
    if (scheduler.remaining > 0) {
      streak += 1
      assert.equal(refreshBlocksAll(scheduler), true)
    } else if (streak > 0) {
      assert.equal(streak, busy)
      assert.equal(refreshBlocksAll(scheduler), false)
      streak = 0
    }
  }
  assert.equal(scheduler.events, Math.floor(horizon / interval))
  assert.equal(scheduler.busyTicksTotal, scheduler.events * busy)
})

test('an idle device still fires refresh on the wall clock', () => {
  const sdr = makeSdr({ refresh: true, refreshInterval: 10, refreshBusy: 4 })
  for (let step = 0; step < 34; step += 1) stepDevice(sdr)
  assert.equal(sdr.tick, 34)
  assert.equal(sdr.refresh.events, Math.floor(34 / 10))
  assert.equal(sdr.refresh.remaining, 0)
  assert.equal(sdr.refresh.busyTicksTotal, sdr.refresh.events * 4)
  assert.equal(sdr.queue.length, 0)
  assert.equal(sdr.activates, 0)
})

test('commodity refresh blocks a new activate and still drains an in-flight burst', () => {
  const sdr = makeSdr({
    manual: true,
    trace: true,
    refresh: true,
    refreshInterval: 32,
    refreshBusy: 8,
    period: 8,
    casClocks: 2,
  })
  primeRow(sdr, 0, 0)
  enqueue(sdr, { id: 1, bank: 0, row: 0, col: 0, burst: 8 })
  stepDevice(sdr, { op: 'read', id: 1, bank: 0, row: 0, col: 0, burst: 8 })
  while (sdr.tick < 32) stepDevice(sdr)
  assert.ok(sdr.refresh.remaining > 0)
  assert.ok(sdr.beats.length > 0)
  const beatsAtLock = sdr.beats.length
  const activatesAtLock = sdr.activates
  stepDevice(sdr, { op: 'activate', bank: 1, row: 3 })
  assert.equal(sdr.core.banks[1].state, 'idle')
  assert.equal(sdr.activates, activatesAtLock)
  while (sdr.refresh.remaining > 0) stepDevice(sdr)
  assert.ok(sdr.beats.length > beatsAtLock)
  assert.equal(sdr.core.banks[1].state, 'idle')
})

test('RDRAM locks one bank, serves another, and rotates the lock', () => {
  const rdram = makeRdram({ refresh: true, refreshInterval: 80, refreshBusy: 12 })
  openRow(rdram, 4, 3)
  while (!(rdram.refresh.lockedBank === 0 && rdram.refresh.remaining > 0)) stepRdram(rdram)
  assert.equal(rdram.channel.mode, 'idle')
  assert.equal(accept(rdram, { id: 4, bank: 4, row: 3, col: 0, burst: 2 }), true)
  assert.equal(accept(rdram, { id: 0, bank: 0, row: 1, col: 0, burst: 2 }), true)
  stepRdram(rdram)
  assert.equal(rdram.outstanding.byId.get(4)?.stage, 'colHeader')
  assert.equal(rdram.channel.mode, 'header')
  assert.equal(rdram.channel.mode === 'header' && rdram.channel.id, 4)
  assert.equal(rdram.outstanding.byId.get(0)?.stage, 'needRow')
  assert.equal(rdram.core.banks[0].state, 'idle')
  const locks: number[] = [0]
  while (rdram.refresh.events < 3) {
    const before = rdram.refresh.events
    stepRdram(rdram)
    if (rdram.refresh.events === before + 1 && rdram.refresh.lockedBank !== null) {
      locks.push(rdram.refresh.lockedBank)
    }
  }
  assert.deepEqual(locks, [0, 1, 2])
})

test('the same refresh seed finishes at the same ticks', () => {
  const jobs = [
    { id: 1, bank: 0, row: 1, col: 0, burst: 4 },
    { id: 2, bank: 1, row: 2, col: 0, burst: 4 },
  ]
  const once = () => runJedec('sdr', jobs, 1, { refresh: 'on' }).tracks.map((track) => track.doneAt)
  assert.deepEqual(once(), once())
  const rdramOnce = () => {
    const rdram = makeRdram({ refresh: true, refreshInterval: 40, refreshBusy: 6 })
    accept(rdram, { id: 1, bank: 0, row: 1, col: 0, burst: 4 })
    accept(rdram, { id: 2, bank: 3, row: 2, col: 0, burst: 4 })
    runUntilSettled(rdram)
    return rdram.finished.map((txn) => [txn.id, txn.doneAt])
  }
  assert.deepEqual(rdramOnce(), rdramOnce())
})
