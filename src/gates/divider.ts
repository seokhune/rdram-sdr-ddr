export type Divider = {
  readonly period: number
  readonly count: number
}

export type DividerEdge = {
  divider: Divider
  rising: boolean
  falling: boolean
}

export function makeDivider(period: number): Divider {
  if (!Number.isInteger(period) || period < 1) {
    throw new Error(`divider period must be an integer >= 1, got ${period}`)
  }
  return { period, count: 0 }
}

export function stepDivider(divider: Divider): DividerEdge {
  const phase = divider.count % divider.period
  const rising = phase === 0
  const falling = divider.period % 2 === 0 && phase === divider.period / 2
  return {
    divider: { period: divider.period, count: divider.count + 1 },
    rising,
    falling,
  }
}
