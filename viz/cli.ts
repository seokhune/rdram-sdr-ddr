import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseArgs } from 'node:util'
import { sha256, toJsonl } from './emit.ts'
import type { ArchName } from './schema.ts'
import { recordScenario } from './trace.ts'

const { values } = parseArgs({
  options: {
    scenario: { type: 'string', default: 'burst' },
    seed: { type: 'string', default: '42' },
    arch: { type: 'string', default: 'all' },
    burst: { type: 'string', default: '8' },
    concurrency: { type: 'string', default: '1' },
    count: { type: 'string' },
    refresh: { type: 'string', default: 'off' },
    out: { type: 'string', default: 'traces' },
  },
})

const archs: ArchName[] =
  values.arch === 'all' ? ['sdr', 'ddr', 'rdram'] : [values.arch as ArchName]

for (const arch of archs) {
  const events = recordScenario({
    scenario: values.scenario ?? 'burst',
    seed: Number(values.seed),
    arch,
    burst: Number(values.burst),
    concurrency: Number(values.concurrency),
    count: values.count ? Number(values.count) : undefined,
    refresh: values.refresh === 'on' ? 'on' : 'off',
  })
  const text = toJsonl(events)
  const file = `${values.out}/${values.scenario}-${arch}-s${values.seed}.jsonl`
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text, 'utf8')
  const hash = await sha256(text)
  console.log(`${arch} ${file} ${hash}`)
}
