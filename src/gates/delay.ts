export type DelayFifo<T> = {
  readonly depth: number
  readonly slots: ReadonlyArray<T | undefined>
}

export function makeDelay<T>(k: number): DelayFifo<T> {
  if (!Number.isInteger(k) || k < 1) {
    throw new Error(`delay depth must be an integer >= 1, got ${k}`)
  }
  return { depth: k, slots: Array.from({ length: k }, () => undefined) }
}

export function pushDelay<T>(
  fifo: DelayFifo<T>,
  value: T | undefined,
): { fifo: DelayFifo<T>; out: T | undefined } {
  const out = fifo.slots[0]
  const slots = fifo.slots.slice(1)
  slots.push(value)
  return { fifo: { depth: fifo.depth, slots }, out }
}
