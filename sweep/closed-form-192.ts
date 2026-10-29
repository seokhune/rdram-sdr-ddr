// 192-point closed-form cross-check: burst b=1..64 x {sdr,ddr,rdram}, simulator vs formula.
import { runArch, type Job } from '../src/metrics/run.ts'

function one(id: number, bank: number, row: number, burst: number): Job {
  return { id, bank, row, col: 0, burst }
}

const closed: Record<string, (b: number) => number> = {
  sdr: (b) => 24 + (b - 1) * 8,
  ddr: (b) => 16 + (b - 1) * 4,
  rdram: (b) => 32 + Math.ceil((8 * b) / 16) * 8 - 1,
}

let mismatches = 0
const results: string[] = []
for (const arch of ['sdr', 'ddr', 'rdram'] as const) {
  for (let b = 1; b <= 64; b++) {
    const row = runArch('burst', arch, [one(1, 0, 0, b)], 1, 100, { open: { bank: 0, row: 0 } })
    const formula = closed[arch](b)
    if (row.ticks !== formula) {
      mismatches++
      results.push(`MISMATCH ${arch} b=${b}: sim=${row.ticks} formula=${formula}`)
    }
  }
}
console.log(`checked 192 points (b=1..64 x 3 archs), mismatches: ${mismatches}`)
if (mismatches > 0) console.log(results.join('\n'))
