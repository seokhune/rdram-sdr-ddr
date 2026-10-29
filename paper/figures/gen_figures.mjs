import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const csvPath = join(root, 'metrics', 'out', 'scenarios.csv')
const outDir = here

const text = readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '')
const [headerLine, ...body] = text.trim().split(/\r?\n/)
const headers = headerLine.split(',')
const rows = body.map((line) => {
  const cells = line.split(',')
  const row = {}
  headers.forEach((key, index) => {
    const value = cells[index]
    row[key] = key === 'scenario' || key === 'arch' ? value : Number(value)
  })
  return row
})

function find(scenario, arch, extra = {}) {
  const hit = rows.find((row) => {
    if (row.scenario !== scenario || row.arch !== arch) return false
    return Object.entries(extra).every(([key, value]) => row[key] === value)
  })
  if (!hit) throw new Error(`missing ${scenario} ${arch} ${JSON.stringify(extra)}`)
  return hit
}

function burstRows(arch) {
  return rows
    .filter((row) => row.scenario === 'burst' && row.arch === arch)
    .sort((left, right) => left.burst - right.burst)
}

function multiRows(arch) {
  return rows
    .filter((row) => row.scenario === 'multi' && row.arch === arch)
    .sort((left, right) => left.concurrency - right.concurrency)
}

const styles = {
  sdr: { dash: '', marker: 'circle', label: 'SDR' },
  ddr: { dash: '9 5', marker: 'square', label: 'DDR' },
  rdram: { dash: '2 4', marker: 'triangle', label: 'RDRAM' },
}

function closedTicks(arch, burst) {
  if (arch === 'sdr') return 24 + (burst - 1) * 8
  if (arch === 'ddr') return 16 + (burst - 1) * 4
  const chunks = Math.ceil((8 * burst) / 16)
  return 32 + chunks * 8 - 1
}

const arches = ['sdr', 'ddr', 'rdram']
const textStyle = `font-family="Batang, 'Malgun Gothic', serif" fill="#000"`

function svgDoc(width, height, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n<rect width="${width}" height="${height}" fill="#fff"/>\n${body}\n</svg>\n`
}

function hatchDefs() {
  return `<defs><pattern id="hatch" patternUnits="userSpaceOnUse" width="6" height="6"><line x1="0" y1="6" x2="6" y2="0" stroke="#000" stroke-width="1.4"/></pattern></defs>`
}

function barPaint(arch) {
  if (arch === 'sdr') return `fill="#000"`
  if (arch === 'ddr') return `fill="#fff" stroke="#000" stroke-width="1.6"`
  return `fill="url(#hatch)" stroke="#000" stroke-width="1.2"`
}

function legendRow(parts, left, y) {
  arches.forEach((arch, index) => {
    const style = styles[arch]
    const x = left + index * 150
    parts.push(`<line x1="${x}" y1="${y}" x2="${x + 36}" y2="${y}" stroke="#000" stroke-width="2.2" stroke-dasharray="${style.dash}"/>`)
    parts.push(marker(style.marker, x + 18, y))
    parts.push(`<text x="${x + 46}" y="${y + 6}" font-size="18" ${textStyle}>${xml(style.label)}</text>`)
  })
}

const offTicks = find('sustain-baseline', 'rdram').ticks
const sweepScenarios = ['sustain-refresh-r50', 'sustain-refresh', 'sustain-refresh-r150']
const sweepDelta = sweepScenarios.map((scenario) => find(scenario, 'rdram').ticks - offTicks)
const sweepWorst = sweepScenarios.map((scenario) => find(scenario, 'rdram').refreshAddedLatencyMax)
const localityGroups = [
  { label: 'row-hit', values: arches.map((arch) => find('row-hit', arch).latP50) },
  { label: 'row-miss', values: arches.map((arch) => find('row-miss', arch).latP50) },
  { label: 'pipeline 동시 4', values: arches.map((arch) => find('pipeline', arch).latP50) },
]

function xml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function marker(kind, x, y) {
  const nx = Number(x)
  const ny = Number(y)
  if (kind === 'circle') return `<circle cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="5" fill="#000"/>`
  if (kind === 'square') return `<rect x="${(nx - 4.5).toFixed(1)}" y="${(ny - 4.5).toFixed(1)}" width="9" height="9" fill="#000"/>`
  return `<polygon points="${nx.toFixed(1)},${(ny - 6).toFixed(1)} ${(nx - 6).toFixed(1)},${(ny + 5).toFixed(1)} ${(nx + 6).toFixed(1)},${(ny + 5).toFixed(1)}" fill="#000"/>`
}

function chart(spec) {
  const width = 920
  const height = 560
  const left = 86
  const right = 36
  const top = 28
  const bottom = 108
  const plotW = width - left - right
  const plotH = height - top - bottom
  const yMax = spec.yMax
  const categories = spec.categories
  const xAt = (index) => left + ((index + 0.5) * plotW) / categories.length
  const yAt = (value) => top + plotH - (value / yMax) * plotH
  const parts = []
  parts.push(`<rect width="${width}" height="${height}" fill="#fff"/>`)
  const yTicks = spec.yTicks
  for (const tick of yTicks) {
    const y = yAt(tick).toFixed(1)
    parts.push(`<line x1="${left}" y1="${y}" x2="${left + plotW}" y2="${y}" stroke="#000" stroke-width="0.6"/>`)
    parts.push(`<text x="${left - 12}" y="${Number(y) + 5}" text-anchor="end" font-size="18" font-family="Batang, 'Malgun Gothic', serif" fill="#000">${xml(tick)}</text>`)
  }
  parts.push(`<line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotH}" stroke="#000" stroke-width="1.6"/>`)
  parts.push(`<line x1="${left}" y1="${top + plotH}" x2="${left + plotW}" y2="${top + plotH}" stroke="#000" stroke-width="1.6"/>`)
  categories.forEach((label, index) => {
    const x = xAt(index)
    parts.push(`<line x1="${x}" y1="${top + plotH}" x2="${x}" y2="${top + plotH + 7}" stroke="#000" stroke-width="1.2"/>`)
    parts.push(`<text x="${x}" y="${top + plotH + 30}" text-anchor="middle" font-size="18" font-family="Batang, 'Malgun Gothic', serif" fill="#000">${xml(label)}</text>`)
  })
  for (const guide of spec.guides ?? []) {
    const y = yAt(guide.value).toFixed(1)
    parts.push(`<line x1="${left}" y1="${y}" x2="${left + plotW}" y2="${y}" stroke="#000" stroke-width="1.2" stroke-dasharray="4 4"/>`)
    parts.push(`<text x="${left + plotW - 6}" y="${Number(y) - 6}" text-anchor="end" font-size="15" font-family="Batang, 'Malgun Gothic', serif" fill="#000">${xml(guide.label)}</text>`)
  }
  for (const series of spec.series) {
    const style = styles[series.arch]
    const points = series.values.map((value, index) => `${xAt(index).toFixed(1)},${yAt(value).toFixed(1)}`)
    parts.push(`<polyline fill="none" stroke="#000" stroke-width="2.2" stroke-dasharray="${style.dash}" points="${points.join(' ')}"/>`)
    series.values.forEach((value, index) => {
      parts.push(marker(style.marker, xAt(index).toFixed(1), yAt(value).toFixed(1)))
    })
  }
  if (spec.callout) {
    const from = xAt(spec.callout.from)
    const to = xAt(spec.callout.to)
    const y = yAt(spec.callout.y) - 22
    parts.push(`<line x1="${from}" y1="${y}" x2="${to}" y2="${y}" stroke="#000" stroke-width="1.4"/>`)
    parts.push(`<line x1="${from}" y1="${y - 6}" x2="${from}" y2="${y + 6}" stroke="#000" stroke-width="1.4"/>`)
    parts.push(`<line x1="${to}" y1="${y - 6}" x2="${to}" y2="${y + 6}" stroke="#000" stroke-width="1.4"/>`)
    parts.push(`<text x="${(from + to) / 2}" y="${y - 10}" text-anchor="middle" font-size="16" font-family="Batang, 'Malgun Gothic', serif" fill="#000">${xml(spec.callout.label)}</text>`)
  }
  const legendY = height - 28
  spec.series.forEach((series, index) => {
    const style = styles[series.arch]
    const x = left + index * 150
    parts.push(`<line x1="${x}" y1="${legendY}" x2="${x + 36}" y2="${legendY}" stroke="#000" stroke-width="2.2" stroke-dasharray="${style.dash}"/>`)
    parts.push(marker(style.marker, x + 18, legendY))
    parts.push(`<text x="${x + 46}" y="${legendY + 6}" font-size="18" font-family="Batang, 'Malgun Gothic', serif" fill="#000">${xml(style.label)}</text>`)
  })
  parts.push(`<text x="${left + plotW / 2}" y="${height - 68}" text-anchor="middle" font-size="18" font-family="Batang, 'Malgun Gothic', serif" fill="#000">${xml(spec.xLabel)}</text>`)
  parts.push(`<text x="26" y="${top + plotH / 2}" text-anchor="middle" font-size="18" font-family="Batang, 'Malgun Gothic', serif" fill="#000" transform="rotate(-90 26 ${top + plotH / 2})">${xml(spec.yLabel)}</text>`)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${parts.join('\n')}\n</svg>\n`
}

function box(x, y, w, h, lines) {
  const text = lines
    .map((line, index) => `<text x="${x + w / 2}" y="${y + 28 + index * 22}" text-anchor="middle" font-size="16" font-family="Batang, 'Malgun Gothic', serif" fill="#000">${xml(line)}</text>`)
    .join('\n')
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="#000" stroke-width="1.6"/>\n${text}`
}

function arrow(x1, y1, x2, y2) {
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const size = 8
  const ax = x2 - size * Math.cos(angle - 0.4)
  const ay = y2 - size * Math.sin(angle - 0.4)
  const bx = x2 - size * Math.cos(angle + 0.4)
  const by = y2 - size * Math.sin(angle + 0.4)
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="1.5"/>
<polygon points="${x2},${y2} ${ax},${ay} ${bx},${by}" fill="#000"/>`
}

function diagram(width, height, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n<rect width="${width}" height="${height}" fill="#fff"/>\n${body}\n</svg>\n`
}

const burstCategories = burstRows('sdr').map((row) => String(row.burst))
const bandwidthChart = chart({
  xLabel: '버스트 길이 (워드)',
  yLabel: '대역폭 (MB/s)',
  yMax: 1800,
  yTicks: [0, 400, 800, 1200, 1600],
  categories: burstCategories,
  guides: [
    { value: 800, label: 'SDR 상한 800' },
    { value: 1600, label: 'DDR·RDRAM 상한 1600' },
  ],
  series: ['sdr', 'ddr', 'rdram'].map((arch) => ({
    arch,
    values: burstRows(arch).map((row) => row.bandwidthMBps),
  })),
})

const efficiencyChart = chart({
  xLabel: '버스트 길이 (워드)',
  yLabel: '채널 효율 (%)',
  yMax: 100,
  yTicks: [0, 20, 40, 60, 80, 100],
  categories: burstCategories,
  series: [
    {
      arch: 'rdram',
      values: burstRows('rdram').map((row) => row.efficiency),
    },
  ],
})

const multiCategories = multiRows('sdr').map((row) => String(row.concurrency))
const rdramMulti = multiRows('rdram').map((row) => row.bandwidthMBps)
const concurrencyChart = chart({
  xLabel: '동시 요청 수',
  yLabel: '대역폭 (MB/s)',
  yMax: 320,
  yTicks: [0, 80, 160, 240, 320],
  categories: multiCategories,
  callout: {
    from: 2,
    to: 3,
    y: 229,
    label: `RDRAM ${rdramMulti[2]}에서 ${rdramMulti[3]}`,
  },
  series: ['sdr', 'ddr', 'rdram'].map((arch) => ({
    arch,
    values: multiRows(arch).map((row) => row.bandwidthMBps),
  })),
})

const fig1 = diagram(
  920,
  520,
  [
    box(330, 24, 260, 64, ['params.ts', '타이밍 상수']),
    box(40, 150, 250, 72, ['jedec.ts', 'SDR·DDR 인터페이스']),
    box(630, 150, 250, 72, ['rdram.ts', '채널과 헤더']),
    box(630, 270, 250, 72, ['outstanding.ts', '미처리 상한 4']),
    box(330, 250, 260, 64, ['bank.ts', '뱅크 상태']),
    box(40, 360, 250, 72, ['refresh.ts', '리프레시 자명종']),
    box(330, 390, 260, 64, ['delay.ts', '지연 큐']),
    box(630, 400, 250, 64, ['metrics', '측정과 CSV']),
    arrow(460, 88, 165, 150),
    arrow(460, 88, 755, 150),
    arrow(755, 222, 755, 270),
    arrow(165, 222, 400, 250),
    arrow(630, 186, 590, 270),
    arrow(165, 360, 400, 314),
    arrow(460, 314, 460, 390),
    arrow(590, 422, 630, 430),
  ].join('\n'),
)

const fig2 = diagram(
  980,
  420,
  [
    box(24, 160, 170, 80, ['아홉 시나리오']),
    box(250, 24, 220, 64, ['지연 곡선', 'burst']),
    box(250, 108, 220, 64, ['지역성', 'row-hit · miss · pipeline']),
    box(250, 192, 220, 64, ['동시성', 'multi']),
    box(250, 276, 220, 64, ['리프레시', 'sustain · single-bank']),
    box(520, 150, 220, 80, ['고정 검사', 'parts · fixed']),
    arrow(194, 190, 250, 56),
    arrow(194, 190, 250, 140),
    arrow(194, 200, 250, 224),
    arrow(194, 210, 250, 308),
    arrow(194, 200, 520, 190),
  ].join('\n'),
)

const fig6 = diagram(
  980,
  460,
  [
    box(340, 20, 300, 64, ['리프레시 이벤트']),
    box(40, 150, 400, 96, ['커머디티', '전 뱅크 동시 정지', '간격 12,500틱, 길이 40틱과 32틱']),
    box(540, 150, 400, 96, ['Direct RDRAM', '뱅크 1개 순환 잠금', '간격 1,562틱, 길이 30틱']),
    box(40, 320, 400, 80, ['새 명령은 모두 대기', '진행 중 데이터는 계속']),
    box(540, 320, 400, 80, ['잠긴 뱅크만 대기', '채널과 나머지 15뱅크는 가동']),
    arrow(420, 84, 240, 150),
    arrow(560, 84, 740, 150),
    arrow(240, 246, 240, 320),
    arrow(740, 246, 740, 320),
  ].join('\n'),
)

function latencyChart() {
  const width = 920
  const height = 560
  const left = 86
  const right = 36
  const top = 36
  const bottom = 108
  const plotW = width - left - right
  const plotH = height - top - bottom
  const yMax = 560
  const xAt = (burst) => left + ((Math.log2(burst) + 0.5) / 7) * plotW
  const yAt = (value) => top + plotH - (value / yMax) * plotH
  const parts = []
  for (const tick of [0, 140, 280, 420, 560]) {
    const y = yAt(tick).toFixed(1)
    parts.push(`<line x1="${left}" y1="${y}" x2="${left + plotW}" y2="${y}" stroke="#000" stroke-width="0.6"/>`)
    parts.push(`<text x="${left - 12}" y="${Number(y) + 5}" text-anchor="end" font-size="18" ${textStyle}>${tick}</text>`)
  }
  parts.push(`<line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotH}" stroke="#000" stroke-width="1.6"/>`)
  parts.push(`<line x1="${left}" y1="${top + plotH}" x2="${left + plotW}" y2="${top + plotH}" stroke="#000" stroke-width="1.6"/>`)
  for (const burst of [1, 2, 4, 8, 16, 32, 64]) {
    const x = xAt(burst)
    parts.push(`<line x1="${x}" y1="${top + plotH}" x2="${x}" y2="${top + plotH + 7}" stroke="#000" stroke-width="1.2"/>`)
    parts.push(`<text x="${x}" y="${top + plotH + 30}" text-anchor="middle" font-size="18" ${textStyle}>${burst}</text>`)
  }
  const x4 = xAt(4)
  parts.push(`<line x1="${x4.toFixed(1)}" y1="${top}" x2="${x4.toFixed(1)}" y2="${top + plotH}" stroke="#000" stroke-width="1.2" stroke-dasharray="2 4"/>`)
  parts.push(`<text x="${(x4 + 8).toFixed(1)}" y="${top + 20}" font-size="16" ${textStyle}>역전</text>`)
  for (const arch of arches) {
    const style = styles[arch]
    const points = []
    for (let burst = 1; burst <= 64; burst += 1) {
      points.push(`${xAt(burst).toFixed(1)},${yAt(closedTicks(arch, burst)).toFixed(1)}`)
    }
    parts.push(`<polyline fill="none" stroke="#000" stroke-width="2.2" stroke-dasharray="${style.dash}" points="${points.join(' ')}"/>`)
    for (const row of burstRows(arch)) {
      parts.push(marker(style.marker, xAt(row.burst).toFixed(1), yAt(row.ticks).toFixed(1)))
    }
  }
  legendRow(parts, left, height - 22)
  parts.push(`<text x="${left + plotW / 2}" y="${height - 52}" text-anchor="middle" font-size="18" ${textStyle}>버스트 길이 b (log₂)</text>`)
  parts.push(`<text x="26" y="${top + plotH / 2}" text-anchor="middle" font-size="18" ${textStyle} transform="rotate(-90 26 ${top + plotH / 2})">첫 지연 (틱)</text>`)
  return svgDoc(width, height, parts.join('\n'))
}

function localityChart() {
  const width = 920
  const height = 560
  const left = 86
  const right = 36
  const top = 36
  const bottom = 108
  const plotW = width - left - right
  const plotH = height - top - bottom
  const yMax = 300
  const yAt = (value) => top + plotH - (value / yMax) * plotH
  const barW = 28
  const inner = 8
  const groupW = arches.length * barW + (arches.length - 1) * inner
  const slot = plotW / localityGroups.length
  const parts = [hatchDefs()]
  for (const tick of [0, 100, 200, 300]) {
    const y = yAt(tick).toFixed(1)
    parts.push(`<line x1="${left}" y1="${y}" x2="${left + plotW}" y2="${y}" stroke="#000" stroke-width="0.6"/>`)
    parts.push(`<text x="${left - 12}" y="${Number(y) + 5}" text-anchor="end" font-size="18" ${textStyle}>${tick}</text>`)
  }
  parts.push(`<line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotH}" stroke="#000" stroke-width="1.6"/>`)
  parts.push(`<line x1="${left}" y1="${top + plotH}" x2="${left + plotW}" y2="${top + plotH}" stroke="#000" stroke-width="1.6"/>`)
  localityGroups.forEach((group, groupIndex) => {
    const origin = left + groupIndex * slot + (slot - groupW) / 2
    const labelX = origin + groupW / 2
    parts.push(`<text x="${labelX}" y="${top + plotH + 30}" text-anchor="middle" font-size="18" ${textStyle}>${xml(group.label)}</text>`)
    group.values.forEach((value, archIndex) => {
      const x = origin + archIndex * (barW + inner)
      const y = yAt(value)
      const h = top + plotH - y
      parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${h.toFixed(1)}" ${barPaint(arches[archIndex])}/>`)
      parts.push(`<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle" font-size="15" ${textStyle}>${value}</text>`)
    })
  })
  arches.forEach((arch, index) => {
    const x = left + index * 170
    const y = height - 22
    parts.push(`<rect x="${x}" y="${y - 8}" width="22" height="14" ${barPaint(arch)}/>`)
    parts.push(`<text x="${x + 30}" y="${y + 4}" font-size="18" ${textStyle}>${styles[arch].label}</text>`)
  })
  parts.push(`<text x="26" y="${top + plotH / 2}" text-anchor="middle" font-size="18" ${textStyle} transform="rotate(-90 26 ${top + plotH / 2})">P50 (틱)</text>`)
  return svgDoc(width, height, parts.join('\n'))
}

function sweepChart() {
  const width = 920
  const height = 560
  const left = 110
  const right = 28
  const plotW = width - left - right
  const labels = ['781', '1,562', '2,343']
  const panels = [
    { title: '(a) 총 완료 틱 증가', values: sweepDelta, yMax: 320, yTicks: [0, 80, 160, 240, 320], top: 48, bottom: 230 },
    { title: '(b) 최악 추가 지연 (틱)', values: sweepWorst, yMax: 1600, yTicks: [0, 400, 800, 1200, 1600], top: 268, bottom: 470 },
  ]
  const parts = [hatchDefs()]
  for (const panel of panels) {
    const plotH = panel.bottom - panel.top
    const yAt = (value) => panel.top + plotH - (value / panel.yMax) * plotH
    parts.push(`<text x="${left}" y="${panel.top - 14}" font-size="18" ${textStyle}>${xml(panel.title)}</text>`)
    for (const tick of panel.yTicks) {
      const y = yAt(tick).toFixed(1)
      parts.push(`<line x1="${left}" y1="${y}" x2="${left + plotW}" y2="${y}" stroke="#000" stroke-width="0.6"/>`)
      parts.push(`<text x="${left - 12}" y="${Number(y) + 5}" text-anchor="end" font-size="16" ${textStyle}>${tick.toLocaleString('en-US')}</text>`)
    }
    parts.push(`<line x1="${left}" y1="${panel.top}" x2="${left}" y2="${panel.bottom}" stroke="#000" stroke-width="1.6"/>`)
    parts.push(`<line x1="${left}" y1="${panel.bottom}" x2="${left + plotW}" y2="${panel.bottom}" stroke="#000" stroke-width="1.6"/>`)
    const slot = plotW / panel.values.length
    const barW = 48
    panel.values.forEach((value, index) => {
      const x = left + index * slot + (slot - barW) / 2
      const y = yAt(value)
      const h = Math.max(panel.bottom - y, 1)
      parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${h.toFixed(1)}" ${barPaint('rdram')}/>`)
      parts.push(`<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle" font-size="16" ${textStyle}>${value.toLocaleString('en-US')}</text>`)
      if (panel.title.startsWith('(b)')) {
        parts.push(`<text x="${(x + barW / 2).toFixed(1)}" y="${panel.bottom + 26}" text-anchor="middle" font-size="18" ${textStyle}>${labels[index]}</text>`)
      }
    })
  }
  parts.push(`<text x="${left + plotW / 2}" y="${548}" text-anchor="middle" font-size="18" ${textStyle}>리프레시 간격 (틱)</text>`)
  return svgDoc(width, height, parts.join('\n'))
}

mkdirSync(outDir, { recursive: true })
const files = {
  'fig1-modules.svg': fig1,
  'fig2-scenarios.svg': fig2,
  'fig3-burst-latency.svg': latencyChart(),
  'fig4-burst-bandwidth.svg': bandwidthChart,
  'fig5-rdram-efficiency.svg': efficiencyChart,
  'fig6-locality-p50.svg': localityChart(),
  'fig7-concurrency.svg': concurrencyChart,
  'fig8-refresh.svg': fig6,
  'fig9-refresh-sweep.svg': sweepChart(),
}
for (const [name, body] of Object.entries(files)) {
  writeFileSync(join(outDir, name), body)
}
for (const name of ['fig3-burst-bandwidth.svg', 'fig4-rdram-efficiency.svg', 'fig5-concurrency.svg', 'fig6-refresh.svg']) {
  const path = join(outDir, name)
  if (existsSync(path)) unlinkSync(path)
}

const mismatches = []
function expect(label, actual, wanted) {
  if (actual !== wanted) mismatches.push(`${label}: csv ${actual}, paper ${wanted}`)
}

for (const arch of ['sdr', 'ddr', 'rdram']) {
  for (const row of burstRows(arch)) {
    expect(`burst ${arch} b${row.burst} ticks`, row.ticks, closedTicks(arch, row.burst))
    expect(`burst ${arch} b${row.burst} latP50`, row.latP50, row.ticks)
  }
}

const burstPaper = {
  sdr: { ticks: [24, 32, 48, 80, 144, 272, 528], bw: [266, 400, 533, 640, 711, 752, 775], eff: [33, 50, 66, 80, 88, 94, 96] },
  ddr: { ticks: [16, 20, 28, 44, 76, 140, 268], bw: [400, 640, 914, 1163, 1347, 1462, 1528], eff: [25, 40, 57, 72, 84, 91, 95] },
  rdram: { ticks: [39, 39, 47, 63, 95, 159, 287], bw: [164, 328, 544, 812, 1077, 1288, 1427], eff: [10, 20, 34, 50, 67, 80, 89] },
}
for (const arch of ['sdr', 'ddr', 'rdram']) {
  const got = burstRows(arch)
  got.forEach((row, index) => {
    expect(`${arch} delay b${row.burst}`, row.ticks, burstPaper[arch].ticks[index])
    expect(`${arch} bw b${row.burst}`, row.bandwidthMBps, burstPaper[arch].bw[index])
    expect(`${arch} eff b${row.burst}`, row.efficiency, burstPaper[arch].eff[index])
  })
}

const locality = [
  ['row-hit', 'sdr', 87, 0],
  ['row-hit', 'ddr', 47, 0],
  ['row-hit', 'rdram', 63, 0],
  ['row-miss', 'sdr', 127, 0],
  ['row-miss', 'ddr', 79, 0],
  ['row-miss', 'rdram', 85, 0],
  ['pipeline', 'sdr', 255, 24],
  ['pipeline', 'ddr', 127, 16],
  ['pipeline', 'rdram', 159, 21],
]
for (const [scenario, arch, p50, overlap] of locality) {
  const row = find(scenario, arch)
  expect(`${scenario} ${arch} p50`, row.latP50, p50)
  expect(`${scenario} ${arch} maxOverlap`, row.maxOverlap, overlap)
}
expect('pipeline sdr bw', find('pipeline', 'sdr').bandwidthMBps, 742)
expect('pipeline ddr bw', find('pipeline', 'ddr').bandwidthMBps, 1442)
expect('pipeline rdram bw', find('pipeline', 'rdram').bandwidthMBps, 1201)
expect('miss delta sdr', find('row-miss', 'sdr').latP50 - find('row-hit', 'sdr').latP50, 40)
expect('miss delta ddr', find('row-miss', 'ddr').latP50 - find('row-hit', 'ddr').latP50, 32)
expect('miss delta rdram', find('row-miss', 'rdram').latP50 - find('row-hit', 'rdram').latP50, 22)

const multiPaper = {
  sdr: [91, 159, 230, 248],
  ddr: [119, 200, 263, 275],
  rdram: [95, 159, 229, 220],
}
for (const arch of ['sdr', 'ddr', 'rdram']) {
  multiRows(arch).forEach((row, index) => {
    expect(`multi ${arch} c${row.concurrency}`, row.bandwidthMBps, multiPaper[arch][index])
  })
}

const sustain = [
  ['sustain-baseline', 'sdr', 131112, 799, 0, 0, 0, 0],
  ['sustain-refresh', 'sdr', 131112, 799, 10, 400, 0, 0],
  ['sustain-baseline', 'ddr', 65564, 1599, 0, 0, 0, 0],
  ['sustain-refresh', 'ddr', 65564, 1599, 5, 160, 0, 32],
  ['sustain-baseline', 'rdram', 109645, 956, 0, 0, 0, 0],
  ['sustain-refresh', 'rdram', 109703, 955, 70, 2100, 0, 32],
]
for (const [scenario, arch, ticks, bw, events, busy, avg, max] of sustain) {
  const row = find(scenario, arch)
  expect(`${scenario} ${arch} ticks`, row.ticks, ticks)
  expect(`${scenario} ${arch} bw`, row.bandwidthMBps, bw)
  expect(`${scenario} ${arch} events`, row.refreshEvents, events)
  expect(`${scenario} ${arch} busy`, row.refreshBusyTicks, busy)
  expect(`${scenario} ${arch} addAvg`, row.refreshAddedLatencyAvg, avg)
  expect(`${scenario} ${arch} addMax`, row.refreshAddedLatencyMax, max)
}
expect('rdram makespan delta', find('sustain-refresh', 'rdram').ticks - find('sustain-baseline', 'rdram').ticks, 58)

const single = find('single-bank-refresh', 'rdram')
expect('single ticks', single.ticks, 16303)
expect('single events', single.refreshEvents, 10)
expect('single busy', single.refreshBusyTicks, 300)
expect('single addMax', single.refreshAddedLatencyMax, 0)
expect('fixed sdr', find('fixed', 'sdr').ticks, 48)
expect('fixed ddr', find('fixed', 'ddr').ticks, 32)
expect('fixed rdram', find('fixed', 'rdram').ticks, 61)
expect('parts b4', find('parts', 'ddr', { burst: 4 }).bandwidthMBps, 914)
expect('parts b64', find('parts', 'ddr', { burst: 64 }).bandwidthMBps, 1528)
expect('fig3 b1', arches.map((arch) => closedTicks(arch, 1)).join('/'), '24/16/39')
expect('fig3 b4', `${closedTicks('sdr', 4)}/${closedTicks('rdram', 4)}`, '48/47')
expect('fig3 b8', arches.map((arch) => closedTicks(arch, 8)).join('/'), '80/44/63')
expect('fig3 b64', arches.map((arch) => closedTicks(arch, 64)).join('/'), '528/268/287')
expect('fig6', localityGroups.map((group) => group.values.join('/')).join(' '), '87/47/63 127/79/85 255/127/159')
expect('fig9 delta', sweepDelta.join('/'), '238/58/230')
expect('fig9 worst', sweepWorst.join('/'), '1285/32/292')

const formulaOnly = [
  ['sdr b3', closedTicks('sdr', 3), 40],
  ['ddr b3', closedTicks('ddr', 3), 24],
  ['rdram b3', closedTicks('rdram', 3), 47],
]
for (const [label, actual, wanted] of formulaOnly) {
  expect(label, actual, wanted)
}
const b3InCsv = rows.some((row) => row.scenario === 'burst' && row.burst === 3)

const readme = readFileSync(join(root, 'README.md'), 'utf8')
const readmeBits = [
  '956 off, 955 on',
  '58틱',
  'makespan grows by 48 ticks on SDR over 4 events, 8 ticks on DDR over 2 events, and 28 ticks on RDRAM over 23 events',
  'worst request grows by 32, 8, and 26 ticks',
  '1.92%(30 / 1,562)',
]
for (const bit of readmeBits) {
  if (!readme.includes(bit)) mismatches.push(`README missing: ${bit}`)
}
const report = [
  '# 수치 재대조',
  '',
  `출처 파일은 metrics/out/scenarios.csv ${rows.length}행과 README.md이다. 생성 스크립트는 paper/figures/gen_figures.mjs이고, 감도 스윕과 192점 대조는 sweep/refresh-sweep.ts와 sweep/closed-form-192.ts이다.`,
  '',
  `CSV 대조 불일치 ${mismatches.length}건.`,
  mismatches.length ? mismatches.map((item) => `- ${item}`).join('\n') : '표 3, 표 4, 표 5, 표 6의 숫자는 CSV와 같다.',
  '리프레시 간격 ±50%의 네 행(-r50/-r150)은 CSV 끝에 있다. 2.6절의 감도 스윕 문장과 같다: sustain 총 틱 109,883 / 109,703 / 109,875, 최악 추가 1,285 / 32 / 292. single-bank 총 틱 16,343 / 16,303 / 16,331, 최악 추가 28 / 0 / 28.',
  '',
  `b = 3의 40, 24, 47틱은 CSV 행이 아니다. CSV에 burst 3 행이 있는지: ${b3InCsv}. 그 세 수는 식 (1), (2), (3)의 값이다.`,
  '동시 1인 400요청의 +48, +8, +28틱과 최악 +32, +8, +26틱은 CSV 행이 아니다. README.md에 있다.',
  'b = 1부터 64까지 192점 대조: sweep/closed-form-192.ts, 불일치 0.',
  '리포 코드(main@42f847b)로 재생성한 scenarios.csv는 원본 42f847b의 CSV와 바이트 단위로 같다. 기준선 재현 확인.',
  'proof/의 세 정리: Lean 4.35.0 재컴파일 오류 0·경고 0. #print axioms는 fifo_emergence [propext], rdram_beats_sdr과 ddr_wins_all [propext, Quot.sound]이다.',
  `6446 / 1562 = ${(6446 / 1562).toFixed(3)}. 1차본의 약 4.1배와 맞다.`,
  `점유율 40/12500 = ${((40 / 12500) * 100).toFixed(2)}%, 32/12500 = ${((32 / 12500) * 100).toFixed(2)}%, 30/1562 = ${((30 / 1562) * 100).toFixed(2)}%.`,
  '',
  '그림 3 버스트 지연. 곡선은 식 (1)~(3)의 b = 1..64. 점은 CSV burst 행의 ticks. 검산은 b = 1에서 24/16/39, b = 4에서 SDR 48과 RDRAM 47, b = 8에서 80/44/63, b = 64에서 528/268/287.',
  '그림 4는 표 3의 대역폭이다. 그림 5는 표 3의 RDRAM 효율이다.',
  '그림 6 지역성 P50. 출처는 CSV latP50. row-hit 87/47/63, row-miss 127/79/85, pipeline 255/127/159. 최대 겹침은 그리지 않는다.',
  '그림 7은 표 5의 동시성 대역폭이다. 그림 8은 리프레시 개념도이고 CSV 숫자가 없다.',
  '그림 9 간격 스윕. off 행은 sustain-baseline rdram의 ticks. 증가(ticks 차)는 238/58/230. refreshAddedLatencyMax는 1285/32/292. 행은 sustain-refresh-r50, sustain-refresh, sustain-refresh-r150.',
  '',
].join('\n')
writeFileSync(join(root, 'paper', 'NUMBER-CHECK.md'), report)
if (mismatches.length) {
  console.error(report)
  process.exit(1)
}
console.log(`wrote ${Object.keys(files).length} svg files and NUMBER-CHECK.md, mismatches ${mismatches.length}`)
