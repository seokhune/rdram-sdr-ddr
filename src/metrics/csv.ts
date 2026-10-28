import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { RunRow } from './run.ts'

const COLUMNS = [
  'scenario',
  'arch',
  'burst',
  'locality',
  'concurrency',
  'ticks',
  'bytes',
  'bandwidthMBps',
  'avgLatency',
  'avgFirst',
  'avgRow',
  'avgColumn',
  'avgTransfer',
  'avgOverlap',
  'maxOverlap',
  'efficiency',
  'refresh',
  'refreshEvents',
  'refreshBusyTicks',
  'latP50',
  'latP99',
  'latMax',
  'refreshAddedLatencyAvg',
  'refreshAddedLatencyMax',
] as const

export function toCsv(rows: readonly RunRow[]): string {
  const lines = [COLUMNS.join(',')]
  for (const row of rows) {
    lines.push(COLUMNS.map((column) => String(row[column])).join(','))
  }
  return `${lines.join('\n')}\n`
}

export function writeCsv(file: string, rows: readonly RunRow[]): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, toCsv(rows), 'utf8')
}
