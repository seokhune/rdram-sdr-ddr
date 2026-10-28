export type HalfRow = {
  readonly slots: ReadonlyArray<boolean>
}

export function makeHalfRow(slotCount = 17): HalfRow {
  return { slots: Array.from({ length: slotCount }, () => false) }
}

export function slotPair(bank: number): [number, number] {
  return [bank, bank + 1]
}

export function canActivate(halfRow: HalfRow, bank: number): boolean {
  const [left, right] = slotPair(bank)
  return halfRow.slots[left] === false && halfRow.slots[right] === false
}

export function occupy(halfRow: HalfRow, bank: number): HalfRow | undefined {
  if (!canActivate(halfRow, bank)) return undefined
  const slots = halfRow.slots.slice()
  const [left, right] = slotPair(bank)
  slots[left] = true
  slots[right] = true
  return { slots }
}

export function release(halfRow: HalfRow, bank: number): HalfRow {
  const slots = halfRow.slots.slice()
  const [left, right] = slotPair(bank)
  slots[left] = false
  slots[right] = false
  return { slots }
}
