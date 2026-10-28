import { writeScenarios } from './metrics/scenarios.ts'

const file = 'metrics/out/scenarios.csv'
const rows = writeScenarios(file)
const header = ['scenario', 'arch', 'conc', 'burst', 'MB/s', 'avgLat', 'first', 'eff', 'overlap']
console.log(header.join('\t'))
for (const row of rows) {
  console.log(
    [
      row.scenario,
      row.arch,
      row.concurrency,
      row.burst,
      row.bandwidthMBps,
      row.avgLatency,
      row.avgFirst,
      row.efficiency,
      row.maxOverlap,
    ].join('\t'),
  )
}
console.log(`csv ${file}`)
