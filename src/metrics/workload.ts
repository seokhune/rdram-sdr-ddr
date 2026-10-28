export type Pattern = 'sequential' | 'random' | 'mixed'

export type Generated = {
  id: number
  bank: number
  row: number
  col: number
  burst: number
}

export function makeRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return (mixed ^ (mixed >>> 14)) >>> 0
  }
}

export function generate(opts: {
  count: number
  seed: number
  pattern: Pattern
  locality: number
  burst: number
  banks: number
  rows: number
  cols: number
}): Generated[] {
  const next = makeRng(opts.seed)
  const pick = (span: number) => next() % span
  const out: Generated[] = []
  let bank = 0
  let row = 0
  let col = 0
  for (let id = 0; id < opts.count; id += 1) {
    const reuse = opts.locality > 0 && id > 0 && pick(100) < opts.locality
    if (!reuse) {
      if (opts.pattern === 'sequential') {
        col += 1
        if (col >= opts.cols) {
          col = 0
          row += 1
          if (row >= opts.rows) {
            row = 0
            bank = (bank + 1) % opts.banks
          }
        }
      } else if (opts.pattern === 'random') {
        bank = pick(opts.banks)
        row = pick(opts.rows)
        col = pick(opts.cols)
      } else {
        bank = pick(opts.banks)
        row = pick(opts.rows)
        col = pick(opts.cols)
      }
    } else if (opts.pattern !== 'sequential') {
      col = pick(opts.cols)
    }
    out.push({ id, bank, row, col, burst: opts.burst })
  }
  return out
}
