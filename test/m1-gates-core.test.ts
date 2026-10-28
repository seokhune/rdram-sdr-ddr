import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeCommand, COMMAND_TABLE } from '../src/core/commands.ts'
import { idleBank, isRowHit, stepBank, tryActivate } from '../src/core/bank.ts'
import { makeCore, stepCore } from '../src/core/dram.ts'
import { decodeAddr, encodeAddr } from '../src/core/decode.ts'
import { canActivate, makeHalfRow, occupy, release } from '../src/core/halfRow.ts'
import { makeDelay, pushDelay } from '../src/gates/delay.ts'
import { makeDivider, stepDivider } from '../src/gates/divider.ts'
import { and, mux, not, or } from '../src/gates/logic.ts'

test('delay FIFO returns the value from k ticks earlier', () => {
  const depth = 4
  let fifo = makeDelay<string>(depth)
  const outs: Array<string | undefined> = []
  for (const value of ['a', 'b', 'c', 'd', 'e']) {
    const pushed = pushDelay(fifo, value)
    fifo = pushed.fifo
    outs.push(pushed.out)
  }
  assert.deepEqual(outs, [undefined, undefined, undefined, undefined, 'a'])
  assert.equal(fifo.slots.length, depth)
  assert.equal(outs[depth - 1], undefined)
  assert.equal(outs[depth], 'a')
})

test('timer reaches 0 and changes state on that same tick', () => {
  let one = tryActivate(idleBank(), 3, 1)
  assert.equal(one.blocked, false)
  if (one.blocked || one.hit) throw new Error('expected a fresh activate')
  assert.equal(one.bank.state, 'rowActivating')
  one = { blocked: false, hit: false, bank: stepBank(one.bank) }
  assert.equal(one.bank.timer, 0)
  assert.equal(one.bank.state, 'active')
  assert.equal(one.bank.openRow, 3)

  let three = tryActivate(idleBank(), 3, 3)
  if (three.blocked || three.hit) throw new Error('expected a fresh activate')
  three = { blocked: false, hit: false, bank: stepBank(three.bank) }
  assert.equal(three.bank.state, 'rowActivating')
  assert.equal(three.bank.timer, 2)
  three = { blocked: false, hit: false, bank: stepBank(three.bank) }
  assert.equal(three.bank.state, 'rowActivating')
  assert.equal(three.bank.timer, 1)
  three = { blocked: false, hit: false, bank: stepBank(three.bank) }
  assert.equal(three.bank.state, 'active')
  assert.equal(three.bank.timer, 0)
})

test('row hit skips activate', () => {
  const open = { state: 'active' as const, openRow: 9, timer: 0 }
  assert.equal(isRowHit(open, 9), true)
  assert.equal(isRowHit(open, 8), false)
  assert.equal(isRowHit(idleBank(), 9), false)
  const hit = tryActivate(open, 9, 5)
  assert.equal(hit.blocked, false)
  if (hit.blocked) throw new Error('row hit is not blocked')
  assert.equal(hit.hit, true)
  assert.equal(hit.bank.state, 'active')
  assert.equal(hit.bank.timer, 0)
  assert.equal(hit.bank.openRow, 9)
})

test('half-row blocks an adjacent bank until release', () => {
  let half = makeHalfRow()
  const held = occupy(half, 0)
  assert.ok(held)
  half = held
  assert.equal(canActivate(half, 1), false)
  assert.equal(occupy(half, 1), undefined)
  assert.equal(canActivate(half, 2), true)
  half = release(half, 0)
  assert.equal(canActivate(half, 1), true)
  assert.equal(half.slots.every((slot) => slot === false), true)
  const again = occupy(half, 1)
  assert.ok(again)
  assert.equal(again.slots[1], true)
  assert.equal(again.slots[2], true)
})

test('banks step independently and commands decode from the truth table', () => {
  let core = makeCore(4)
  const first = tryActivate(core.banks[0], 1, 2)
  const second = tryActivate(core.banks[2], 4, 1)
  if (first.blocked || first.hit || second.blocked || second.hit) {
    throw new Error('both banks start idle')
  }
  core = { banks: core.banks.slice() }
  core.banks[0] = first.bank
  core.banks[2] = second.bank
  core = stepCore(core)
  assert.equal(core.banks[0].state, 'rowActivating')
  assert.equal(core.banks[2].state, 'active')
  assert.equal(core.banks[1].state, 'idle')
  assert.equal(decodeCommand(COMMAND_TABLE.ACTIVATE), 'ACTIVATE')
  assert.equal(decodeCommand(COMMAND_TABLE.READ), 'READ')
  assert.equal(decodeCommand(COMMAND_TABLE.WRITE), 'WRITE')
  assert.equal(decodeCommand(COMMAND_TABLE.PRECHARGE), 'PRECHARGE')
  assert.equal(decodeCommand({ cs: 0, ras: 1, cas: 1, we: 1 }), undefined)
  const geometry = { colBits: 8, rowBits: 12, bankBits: 2 }
  const parts = { bank: 3, row: 20, col: 7 }
  assert.deepEqual(decodeAddr(encodeAddr(parts, geometry), geometry), parts)
  assert.equal(and(1, 1), 1)
  assert.equal(or(0, 0), 0)
  assert.equal(not(1), 0)
  assert.equal(mux(0, 'keep', 'drop'), 'keep')
})

test('divider rises every period ticks', () => {
  let divider = makeDivider(8)
  const rising: number[] = []
  const falling: number[] = []
  for (let tick = 0; tick < 16; tick += 1) {
    const edge = stepDivider(divider)
    divider = edge.divider
    if (edge.rising) rising.push(tick)
    if (edge.falling) falling.push(tick)
  }
  assert.deepEqual(rising, [0, 8])
  assert.deepEqual(falling, [4, 12])
})
