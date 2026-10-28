import { bankColor, closedTicks, STATE_COLOR } from './format.ts'
import type { TraceIndex } from './tape.ts'
import { visible } from './tape.ts'
import type { Snapshot } from '../../viz/fold.ts'

export type View = {
  origin: number
  span: number
  tick: number
  highlight: { start: number; end: number } | null
}

type Lane = { id: string; y: number; h: number; label: string }

export function layoutOf(arch: string, banks: number): { lanes: Lane[]; height: number } {
  const lanes: Lane[] = []
  let y = 4
  const add = (id: string, h: number, label: string) => {
    lanes.push({ id, y, h, label })
    y += h
  }
  add('cmd', 28, 'cmd')
  for (let bank = 0; bank < banks; bank += 1) add(`bank-${bank}`, 18, `b${bank}`)
  if (arch === 'rdram') {
    for (let slot = 0; slot < 17; slot += 1) add(`slot-${slot}`, 8, String(slot))
    add('chan', 22, 'chan')
  }
  add('pin', 24, 'DQ')
  return { lanes, height: y + 8 }
}

function prepare(canvas: HTMLCanvasElement, height: number): CanvasRenderingContext2D | null {
  const width = canvas.clientWidth
  if (width < 2) return null
  const ratio = window.devicePixelRatio || 1
  canvas.width = Math.floor(width * ratio)
  canvas.height = Math.floor(height * ratio)
  canvas.style.height = `${height}px`
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, width, height)
  return ctx
}

export function drawTimeline(
  canvas: HTMLCanvasElement,
  index: TraceIndex,
  snap: Snapshot,
  view: View,
): void {
  const { lanes, height } = layoutOf(snap.arch, snap.banks.length)
  const ctx = prepare(canvas, height)
  if (!ctx) return
  const width = canvas.clientWidth
  const gutter = 44
  const plot = Math.max(1, width - gutter)
  const xOf = (tick: number) => gutter + ((tick - view.origin) / view.span) * plot
  const lane = (id: string) => lanes.find((item) => item.id === id)
  ctx.fillStyle = '#14181d'
  ctx.fillRect(0, 0, width, height)
  ctx.font = '11px ui-monospace, monospace'
  ctx.textBaseline = 'middle'
  for (const item of lanes) {
    ctx.fillStyle = '#8b97a3'
    ctx.fillText(item.label, 4, item.y + item.h / 2)
    ctx.strokeStyle = '#232a32'
    ctx.beginPath()
    ctx.moveTo(gutter, item.y + item.h)
    ctx.lineTo(width, item.y + item.h)
    ctx.stroke()
  }
  if (view.highlight) {
    const left = xOf(view.highlight.start)
    const right = xOf(view.highlight.end)
    ctx.fillStyle = 'rgba(255,255,255,0.06)'
    ctx.fillRect(left, 0, Math.max(1, right - left), height)
  }
  for (const span of visible(index.refresh, view.origin, view.span)) {
    const left = xOf(span.start)
    const right = xOf(span.end)
    if (span.mode === 'bank' && span.lockedBank !== null) {
      const row = lane(`bank-${span.lockedBank}`)
      if (!row) continue
      ctx.fillStyle = 'rgba(226, 193, 90, 0.28)'
      ctx.fillRect(left, row.y + 1, Math.max(1, right - left), row.h - 2)
      ctx.fillStyle = '#e2c15a'
      ctx.fillRect(left + 2, row.y + 4, 6, 5)
      ctx.fillRect(left + 3, row.y + 2, 4, 3)
    } else {
      ctx.fillStyle = 'rgba(226, 193, 90, 0.16)'
      ctx.fillRect(left, 0, Math.max(1, right - left), height)
    }
  }
  const cmd = lane('cmd')
  if (cmd) {
    for (const command of index.commands) {
      if (command.tick < view.origin || command.tick > view.origin + view.span) continue
      const x = xOf(command.tick)
      ctx.fillStyle = bankColor(command.bank)
      const label = command.decoded === 'ACTIVATE' ? 'ACT' : command.decoded === 'PRECHARGE' ? 'PRE' : command.decoded.slice(0, 4)
      const box = Math.max(22, label.length * 7)
      ctx.fillRect(x, cmd.y + 4, box, cmd.h - 8)
      ctx.fillStyle = '#101318'
      ctx.fillText(label, x + 3, cmd.y + cmd.h / 2)
    }
  }
  for (const span of visible(index.banks, view.origin, view.span)) {
    const row = lane(`bank-${span.bank}`)
    if (!row) continue
    const left = xOf(Math.max(span.start, view.origin))
    const right = xOf(Math.min(span.end, view.origin + view.span))
    ctx.fillStyle = STATE_COLOR[span.state] ?? '#333'
    ctx.fillRect(left, row.y + 2, Math.max(1, right - left), row.h - 4)
    if (span.state === 'active' && span.openRow !== null && right - left > 28) {
      ctx.fillStyle = '#102016'
      ctx.fillText(`r${span.openRow}`, left + 3, row.y + row.h / 2)
    }
  }
  for (let slot = 0; slot < 17; slot += 1) {
    const row = lane(`slot-${slot}`)
    if (!row) continue
    for (const span of visible(index.half, view.origin, view.span)) {
      if (span.bank !== slot && span.bank + 1 !== slot) continue
      const left = xOf(Math.max(span.start, view.origin))
      const right = xOf(Math.min(span.end, view.origin + view.span))
      ctx.fillStyle = bankColor(span.bank)
      ctx.globalAlpha = span.bank + 1 === slot && span.bank !== slot ? 0.85 : 1
      ctx.fillRect(left, row.y + 1, Math.max(1, right - left), row.h - 2)
      ctx.globalAlpha = 1
    }
  }
  const channel = lane('chan')
  if (channel) {
    const drawn: { start: number; end: number }[] = []
    for (const span of visible(index.channels, view.origin, view.span)) {
      const overlaps = drawn.some((prior) => span.start < prior.end && prior.start < span.end)
      const left = xOf(span.start)
      const right = xOf(span.end)
      ctx.fillStyle = overlaps ? '#e23b3b' : span.seg === 'ROW' ? '#e0924a' : span.seg === 'COL' ? '#6ea8fe' : '#3cba78'
      ctx.fillRect(left, channel.y + 4, Math.max(1, right - left), channel.h - 8)
      if (right - left > 24) {
        ctx.fillStyle = '#101318'
        ctx.fillText(span.seg, left + 3, channel.y + channel.h / 2)
      }
      drawn.push(span)
    }
  }
  const pin = lane('pin')
  if (pin) {
    const bucket = new Map<number, number>()
    for (const word of index.pins) {
      if (word.tick < view.origin || word.tick > view.origin + view.span) continue
      const x = Math.floor(xOf(word.tick))
      bucket.set(x, word.reqId)
    }
    for (const [x, reqId] of bucket) {
      const bank = index.reqBank.get(reqId) ?? reqId % 16
      ctx.fillStyle = bankColor(bank)
      ctx.fillRect(x, pin.y + 6, Math.max(2, plot / view.span), pin.h - 12)
    }
  }
  const play = xOf(view.tick)
  ctx.strokeStyle = '#f4f7fb'
  ctx.beginPath()
  ctx.moveTo(play, 0)
  ctx.lineTo(play, height)
  ctx.stroke()
  for (let bank = 0; bank < snap.banks.length; bank += 1) {
    const row = lane(`bank-${bank}`)
    const state = snap.banks[bank]
    if (!row || !state || state.state === 'idle') continue
    ctx.fillStyle = '#f4f7fb'
    ctx.fillText(String(state.timer), Math.min(width - 18, play + 4), row.y + row.h / 2)
  }
}

export function drawMinimap(canvas: HTMLCanvasElement, index: TraceIndex, view: View, total: number): void {
  const ctx = prepare(canvas, 36)
  if (!ctx) return
  const width = canvas.clientWidth
  ctx.fillStyle = '#14181d'
  ctx.fillRect(0, 0, width, 36)
  const xOf = (tick: number) => (tick / Math.max(1, total)) * width
  for (const span of index.banks) {
    if (span.state === 'idle') continue
    ctx.fillStyle = STATE_COLOR[span.state] ?? '#333'
    ctx.fillRect(xOf(span.start), 8, Math.max(1, xOf(span.end) - xOf(span.start)), 8)
  }
  for (const word of index.pins) {
    ctx.fillStyle = '#d7dee6'
    ctx.fillRect(xOf(word.tick), 20, 1, 8)
  }
  ctx.strokeStyle = '#f4f7fb'
  ctx.strokeRect(xOf(view.origin), 2, Math.max(2, xOf(view.origin + view.span) - xOf(view.origin)), 32)
}

export function drawWave(canvas: HTMLCanvasElement, index: TraceIndex, view: View): void {
  const height = 132
  const ctx = prepare(canvas, height)
  if (!ctx) return
  const width = canvas.clientWidth
  const names = ['CS', 'RAS', 'CAS', 'WE', 'DQ'] as const
  const row = (height - 8) / names.length
  ctx.fillStyle = '#14181d'
  ctx.fillRect(0, 0, width, height)
  ctx.font = '11px ui-monospace, monospace'
  ctx.textBaseline = 'middle'
  const xOf = (tick: number) => 36 + ((tick - view.origin) / view.span) * Math.max(1, width - 40)
  const steps = Math.max(1, Math.min(view.span, view.span <= 800 ? view.span : Math.floor(width)))
  for (let name = 0; name < names.length; name += 1) {
    const y = 4 + name * row
    ctx.fillStyle = '#8b97a3'
    ctx.fillText(names[name], 4, y + row / 2)
    ctx.strokeStyle = names[name] === 'DQ' ? '#3cba78' : '#d7dee6'
    ctx.beginPath()
    for (let step = 0; step <= steps; step += 1) {
      const tick = view.origin + Math.floor((step * view.span) / steps)
      const level = levelAt(index, names[name], tick)
      const x = xOf(tick)
      const py = y + (level ? 4 : row - 6)
      if (step === 0) ctx.moveTo(x, py)
      else ctx.lineTo(x, py)
    }
    ctx.stroke()
  }
  const play = xOf(view.tick)
  ctx.strokeStyle = '#f4f7fb'
  ctx.beginPath()
  ctx.moveTo(play, 0)
  ctx.lineTo(play, height)
  ctx.stroke()
}

function levelAt(index: TraceIndex, name: 'CS' | 'RAS' | 'CAS' | 'WE' | 'DQ', tick: number): number {
  if (name === 'DQ') return index.pins.some((pin) => pin.tick === tick) ? 1 : 0
  const command = index.commands.find((item) => item.tick === tick)
  if (!command) return name === 'CS' ? 1 : 1
  return command.pins[name.toLowerCase() as 'cs' | 'ras' | 'cas' | 'we']
}

export type CsvPoint = { arch: string; burst: number; ticks: number }

export function burstRows(csv: string): CsvPoint[] {
  const lines = csv.trim().split('\n')
  const header = lines[0]?.split(',') ?? []
  const scenario = header.indexOf('scenario')
  const arch = header.indexOf('arch')
  const burst = header.indexOf('burst')
  const ticks = header.indexOf('ticks')
  const points: CsvPoint[] = []
  for (const line of lines.slice(1)) {
    const cell = line.split(',')
    if (cell[scenario] !== 'burst') continue
    points.push({
      arch: cell[arch] ?? '',
      burst: Number(cell[burst]),
      ticks: Number(cell[ticks]),
    })
  }
  return points
}

export function drawChart(canvas: HTMLCanvasElement, points: readonly CsvPoint[]): void {
  const height = 160
  const ctx = prepare(canvas, height)
  if (!ctx) return
  const width = canvas.clientWidth
  ctx.fillStyle = '#14181d'
  ctx.fillRect(0, 0, width, height)
  const bursts = [1, 2, 4, 8, 16, 32, 64]
  const maxTick = Math.max(1, ...points.map((point) => point.ticks), ...bursts.map((burst) => closedTicks('sdr', burst)))
  const left = 36
  const plot = Math.max(1, width - left - 8)
  const xOf = (burst: number) => left + (Math.log2(burst) / Math.log2(64)) * plot
  const yOf = (tick: number) => 12 + (1 - tick / maxTick) * (height - 28)
  ctx.strokeStyle = '#2a323b'
  ctx.strokeRect(left, 12, plot, height - 28)
  ctx.font = '10px ui-monospace, monospace'
  ctx.fillStyle = '#8b97a3'
  for (const burst of bursts) ctx.fillText(String(burst), xOf(burst) - 4, height - 4)
  const colors: Record<string, string> = { sdr: '#e26b7a', ddr: '#6ea8fe', rdram: '#3cba78' }
  for (const arch of ['sdr', 'ddr', 'rdram']) {
    const series = points.filter((point) => point.arch === arch).sort((a, b) => a.burst - b.burst)
    ctx.strokeStyle = colors[arch] ?? '#fff'
    ctx.beginPath()
    series.forEach((point, index) => {
      const x = xOf(point.burst)
      const y = yOf(point.ticks)
      if (index === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
    for (const burst of bursts) {
      ctx.fillStyle = colors[arch] ?? '#fff'
      ctx.beginPath()
      ctx.arc(xOf(burst), yOf(closedTicks(arch, burst)), 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}
