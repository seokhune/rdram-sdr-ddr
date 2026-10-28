import { useEffect, useMemo, useRef, useState } from 'react'
import csvText from '../../metrics/out/scenarios.csv?raw'
import { parseJsonl, sha256, toJsonl } from '../../viz/emit.ts'
import type { Snapshot } from '../../viz/fold.ts'
import { fifoIdFor, type TraceEvent } from '../../viz/schema.ts'
import { recordScenario, type RecordRequest } from '../../viz/trace.ts'
import { burstRows, drawChart, drawMinimap, drawTimeline, drawWave, layoutOf } from './draw.ts'
import { nsLabel, percentile } from './format.ts'
import { Cursor, headerOf, indexTrace, type TraceIndex } from './tape.ts'

type Arch = 'sdr' | 'ddr' | 'rdram'
type Speed = 1 | 8 | 60 | 0

const KINDS = ['edge', 'cmd', 'bank', 'fifo', 'pin', 'chan', 'outstanding', 'halfrow', 'refresh', 'req']

function advance(current: number, by: number): number {
  return current - (0 - by)
}

function loadTrace(request: RecordRequest): TraceEvent[] {
  return recordScenario(request)
}

export function App() {
  const [scenario, setScenario] = useState('burst')
  const [seed, setSeed] = useState(42)
  const [burst, setBurst] = useState(8)
  const [concurrency, setConcurrency] = useState(1)
  const [refresh, setRefresh] = useState<'off' | 'on'>('off')
  const [arch, setArch] = useState<Arch>('sdr')
  const [other, setOther] = useState<Arch>('ddr')
  const [ab, setAb] = useState(false)
  const [events, setEvents] = useState<TraceEvent[] | null>(null)
  const [otherEvents, setOtherEvents] = useState<TraceEvent[] | null>(null)
  const [tick, setTick] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<Speed>(8)
  const [origin, setOrigin] = useState(0)
  const [span, setSpan] = useState(128)
  const [selected, setSelected] = useState<number | null>(1)
  const [kind, setKind] = useState<string>('all')
  const [note, setNote] = useState('')
  const [raw, setRaw] = useState(false)
  const [error, setError] = useState('')
  const play = useRef({ playing: false, speed: 8 as Speed, tick: 0, total: 1 })

  const request: RecordRequest = { scenario, seed, arch, burst, concurrency, refresh }

  function adopt(next: TraceEvent[], side: TraceEvent[] | null) {
    const header = headerOf(next)
    setEvents(next)
    setOtherEvents(side)
    setTick(0)
    setOrigin(0)
    setSpan(Math.min(160, Math.max(32, header.totalTicks)))
    setSelected(1)
    setPlaying(false)
    setError('')
  }

  function record() {
    try {
      const next = loadTrace(request)
      const side = ab ? loadTrace({ ...request, arch: other }) : null
      adopt(next, side)
      setNote('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'record failed')
    }
  }

  useEffect(() => {
    record()
  }, [])

  const index = useMemo(() => (events ? indexTrace(events) : null), [events])
  const otherIndex = useMemo(() => (otherEvents ? indexTrace(otherEvents) : null), [otherEvents])
  const cursor = useRef<Cursor | null>(null)
  const otherCursor = useRef<Cursor | null>(null)
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [otherSnap, setOtherSnap] = useState<Snapshot | null>(null)

  useEffect(() => {
    if (!events) return
    cursor.current = new Cursor(events)
    otherCursor.current = otherEvents ? new Cursor(otherEvents) : null
    setSnap(cursor.current.seek(0))
    setOtherSnap(otherCursor.current ? otherCursor.current.seek(0) : null)
  }, [events, otherEvents])

  useEffect(() => {
    if (!cursor.current) return
    setSnap(cursor.current.seek(tick))
    if (otherCursor.current) setOtherSnap(otherCursor.current.seek(tick))
  }, [tick])

  const total = snap?.totalTicks ?? 0
  play.current = { playing, speed, tick, total }

  useEffect(() => {
    let frame = 0
    let last = performance.now()
    let acc = 0
    const loop = (now: number) => {
      const dt = now - last
      last = now
      const state = play.current
      if (state.playing) {
        acc += state.speed === 0 ? 256 : (dt * state.speed) / 1000
        const step = Math.floor(acc)
        acc -= step
        if (step > 0) {
          const next = Math.min(state.total, advance(state.tick, step))
          state.tick = next
          setTick(next)
          if (next >= state.total) {
            state.playing = false
            setPlaying(false)
          }
        }
      }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (!playing) return
    if (tick < origin || tick > origin + span) setOrigin(Math.max(0, tick - Math.floor(span / 5)))
  }, [tick, playing, origin, span])

  function scrub(next: number) {
    const bounded = Math.max(0, Math.min(total, next))
    play.current.tick = bounded
    setTick(bounded)
  }

  function zoom(factor: number) {
    const next = Math.max(16, Math.min(Math.max(total, 16), Math.round(span * factor)))
    setSpan(next)
    setOrigin(Math.max(0, tick - Math.floor(next / 5)))
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return
      if (event.code === 'Space') {
        event.preventDefault()
        setPlaying((value) => !value)
      } else if (event.key === 'ArrowRight') scrub(advance(tick, event.shiftKey ? 8 : 1))
      else if (event.key === 'ArrowLeft') scrub(tick - (event.shiftKey ? 8 : 1))
      else if (event.key === 'Home') scrub(0)
      else if (event.key === 'End') scrub(total)
      else if (event.key === '+' || event.key === '=') zoom(0.5)
      else if (event.key === '-' || event.key === '_') zoom(2)
      else if (event.key === 'r' || event.key === 'R') setRaw(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function replayCheck() {
    const again = loadTrace(request)
    const [left, right] = await Promise.all([sha256(toJsonl(events ?? [])), sha256(toJsonl(again))])
    setNote(left === right ? `replay check matches ${left.slice(0, 16)}` : 'replay check mismatch')
  }

  async function openFile(file: File) {
    try {
      adopt(parseJsonl(await file.text()), null)
      setAb(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'parse failed')
    }
  }

  const points = useMemo(() => burstRows(csvText), [])

  return (
    <div className="app">
      <header className="bar">
        <strong>Trace replay</strong>
        <label>
          Scenario
          <select value={scenario} onChange={(event) => setScenario(event.target.value)}>
            <option value="burst">burst</option>
            <option value="golden-cl2">golden-cl2</option>
            <option value="random">random</option>
            <option value="sustain">sustain</option>
          </select>
        </label>
        <label>
          Seed
          <input type="number" value={seed} onChange={(event) => setSeed(Number(event.target.value))} />
        </label>
        <label>
          Burst
          <input type="number" value={burst} min={1} onChange={(event) => setBurst(Number(event.target.value))} />
        </label>
        <label>
          Conc
          <input type="number" value={concurrency} min={1} onChange={(event) => setConcurrency(Number(event.target.value))} />
        </label>
        <label>
          Refresh
          <select value={refresh} onChange={(event) => setRefresh(event.target.value === 'on' ? 'on' : 'off')}>
            <option value="off">off</option>
            <option value="on">on</option>
          </select>
        </label>
        <div className="tabs">
          {(['sdr', 'ddr', 'rdram'] as const).map((name) => (
            <button key={name} className={arch === name ? 'on' : ''} onClick={() => setArch(name)}>
              {name.toUpperCase()}
            </button>
          ))}
        </div>
        <button className={ab ? 'on' : ''} onClick={() => setAb((value) => !value)}>
          A/B
        </button>
        {ab ? (
          <select value={other} onChange={(event) => setOther(event.target.value as Arch)}>
            {(['sdr', 'ddr', 'rdram'] as const).map((name) => (
              <option key={name} value={name}>
                {name.toUpperCase()}
              </option>
            ))}
          </select>
        ) : null}
        <button onClick={record}>Record</button>
        <button onClick={replayCheck}>Replay check</button>
        <label className="file">
          JSONL
          <input
            type="file"
            accept=".jsonl,application/json"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void openFile(file)
            }}
          />
        </label>
        <span className="note">{error || note}</span>
      </header>
      <div className="transport">
        <button onClick={() => setPlaying((value) => !value)}>{playing ? 'Pause' : 'Play'}</button>
        <button onClick={() => scrub(tick - 1)}>−1</button>
        <button onClick={() => scrub(advance(tick, 1))}>+1</button>
        {([1, 8, 60, 0] as const).map((value) => (
          <button key={value} className={speed === value ? 'on' : ''} onClick={() => setSpeed(value)}>
            {value === 0 ? 'max' : `${value}×`}
          </button>
        ))}
        <button onClick={() => zoom(0.5)}>Zoom in</button>
        <button onClick={() => zoom(2)}>Zoom out</button>
        <span className="tick">
          tick {tick} / {total} · {nsLabel(tick)}
        </span>
        {snap?.nextEventAt !== null && snap?.nextEventAt !== undefined ? (
          <span className="tick">next refresh {snap.nextEventAt}</span>
        ) : null}
      </div>
      <div className={ab ? 'stage ab' : 'stage'}>
        <div className="center">
          {events && index && snap ? (
            <Player
              title={headerOf(events).arch.toUpperCase()}
              events={events}
              index={index}
              snap={snap}
              tick={tick}
              origin={origin}
              span={span}
              selected={selected}
              onScrub={scrub}
              onOrigin={setOrigin}
            />
          ) : (
            <p className="wait">Recording the trace.</p>
          )}
          {ab && otherEvents && otherIndex && otherSnap ? (
            <Player
              title={headerOf(otherEvents).arch.toUpperCase()}
              events={otherEvents}
              index={otherIndex}
              snap={otherSnap}
              tick={tick}
              origin={origin}
              span={span}
              selected={selected}
              onScrub={scrub}
              onOrigin={setOrigin}
            />
          ) : null}
        </div>
        <aside className="side">
          {snap ? <Metrics snap={snap} tick={tick} /> : null}
          <Chart points={points} />
          {snap ? <Outstanding snap={snap} tick={tick} /> : null}
        </aside>
      </div>
      <div className="bottom">
        {snap ? (
          <Requests
            snap={snap}
            other={otherSnap}
            tick={tick}
            selected={selected}
            onPick={(id, start, end) => {
              setSelected(id)
              const width = Math.max(32, end - start)
              setSpan(width)
              setOrigin(Math.max(0, start))
              scrub(start)
            }}
          />
        ) : null}
        {events ? (
          <Log
            events={events}
            tick={tick}
            kind={kind}
            onKind={setKind}
            onJump={scrub}
          />
        ) : null}
      </div>
      {raw && events ? (
        <div className="popup" role="dialog">
          <header>
            Events at tick {tick}
            <button onClick={() => setRaw(false)}>Close</button>
          </header>
          <pre>
            {events
              .filter((event) => event.kind !== 'sim' && event.tick === tick)
              .map((event) => JSON.stringify(event))
              .join('\n') || 'No events at this tick.'}
          </pre>
        </div>
      ) : null}
    </div>
  )
}

function Player(props: {
  title: string
  events: TraceEvent[]
  index: TraceIndex
  snap: Snapshot
  tick: number
  origin: number
  span: number
  selected: number | null
  onScrub: (tick: number) => void
  onOrigin: (origin: number) => void
}) {
  const timeline = useRef<HTMLCanvasElement>(null)
  const minimap = useRef<HTMLCanvasElement>(null)
  const wave = useRef<HTMLCanvasElement>(null)
  const chartWait = props.snap
  const request = chartWait.requests.find((item) => item.id === props.selected)
  const highlight =
    request && request.enqueuedAt !== null
      ? { start: request.enqueuedAt, end: request.completedAt ?? props.tick }
      : null
  const view = { origin: props.origin, span: props.span, tick: props.tick, highlight }
  useEffect(() => {
    const board = timeline.current
    const map = minimap.current
    const scope = wave.current
    if (board) drawTimeline(board, props.index, props.snap, view)
    if (map) drawMinimap(map, props.index, view, props.snap.totalTicks)
    if (scope) drawWave(scope, props.index, view)
  })
  const height = layoutOf(props.snap.arch, props.snap.banks.length).height
  function tickAt(canvas: HTMLCanvasElement, clientX: number): number {
    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left - 44
    const ratio = Math.min(1, Math.max(0, x / Math.max(1, rect.width - 44)))
    return props.origin + Math.round(ratio * props.span)
  }
  const fifoId = fifoIdFor(props.snap.arch as 'sdr' | 'ddr' | 'rdram')
  const slots = props.snap.fifos[fifoId] ?? []
  const live = props.index.transits.filter(
    (transit) => transit.pushTick <= props.tick && (transit.popTick === null || transit.popTick > props.tick),
  )
  return (
    <section className="player">
      <h2>{props.title}</h2>
      <canvas
        ref={minimap}
        className="minimap"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          const ratio = (event.clientX - rect.left) / Math.max(1, rect.width)
          const next = Math.round(ratio * props.snap.totalTicks)
          props.onOrigin(Math.max(0, next - Math.floor(props.span / 5)))
          props.onScrub(next)
        }}
      />
      <div className="timeline-scroll">
        <canvas
          ref={timeline}
          className="timeline"
          style={{ height }}
          onClick={(event) => props.onScrub(tickAt(event.currentTarget, event.clientX))}
        />
      </div>
      <canvas ref={wave} className="wave" onClick={(event) => props.onScrub(tickAt(event.currentTarget, event.clientX))} />
      <Fifo
        key={`${props.snap.arch}-${props.snap.scenario}-${props.snap.seed}`}
        slots={slots}
        live={live}
        transits={props.index.transits}
        depth={slots.length}
        shifted={props.snap.edges.some((edge) => edge.tick === props.tick && edge.edge === 'rise')}
      />
      <WaveNote index={props.index} />
    </section>
  )
}

function shiftsAfter(transits: { popTick: number | null }[], pushTick: number, popTick: number): number {
  let count = 0
  for (const transit of transits) {
    if (transit.popTick === null || transit.popTick <= pushTick || transit.popTick > popTick) continue
    count += 1
  }
  return count
}

function Fifo(props: {
  slots: { token: string | null; pushTick: number }[]
  live: { token: string | null; pushTick: number; popTick: number | null }[]
  transits: { popTick: number | null }[]
  depth: number
  shifted: boolean
}) {
  const [pick, setPick] = useState(() => {
    const found = props.slots.findIndex((slot) => slot.token !== null)
    return found < 0 ? 0 : found
  })
  const fact = props.live[pick]
  const shifts = fact === undefined || fact.popTick === null ? null : shiftsAfter(props.transits, fact.pushTick, fact.popTick)
  return (
    <div className="fifo">
      <div className="fifo-title">Column pipe</div>
      <div className={props.shifted ? 'fifo-row shift' : 'fifo-row'}>
        {props.slots.map((item, index) => (
          <button key={`${item.pushTick}-${index}`} className={item.token ? 'token on-token' : 'token'} onClick={() => setPick(index)}>
            {item.token ?? '·'}
          </button>
        ))}
      </div>
      {fact ? (
        <p>
          Token {fact.token ?? 'bubble'} was pushed at tick {fact.pushTick} and comes out at tick {fact.popTick ?? 'still inside'}.
          {shifts === null ? '' : ` Shift count ${shifts}. Pipe depth ${props.depth}.`}
        </p>
      ) : (
        <p>The pipe is empty at this tick.</p>
      )}
    </div>
  )
}

function WaveNote(props: { index: TraceIndex }) {
  const read = props.index.commands.find((command) => command.decoded === 'READ')
  const first = props.index.pins[0]
  if (!read || !first) return null
  return (
    <p className="caption">
      READ at tick {read.tick}. First word at tick {first.tick}.
    </p>
  )
}

function Metrics(props: { snap: Snapshot; tick: number }) {
  const done = props.snap.requests.filter((item) => item.completedAt !== null && item.enqueuedAt !== null && (item.completedAt ?? 0) <= props.tick)
  const latencies = done.map((item) => (item.completedAt ?? 0) - (item.enqueuedAt ?? 0))
  const inflight = props.snap.requests.filter(
    (item) => item.enqueuedAt !== null && item.enqueuedAt <= props.tick && (item.completedAt === null || item.completedAt > props.tick),
  ).length
  const pins = props.snap.pins.length
  const util = props.tick === 0 ? 0 : Math.floor((pins * 100) / props.tick)
  return (
    <section>
      <h2>So far</h2>
      <dl>
        <div>
          <dt>Completed</dt>
          <dd>{done.length}</dd>
        </div>
        <div>
          <dt>In flight</dt>
          <dd>{inflight}</dd>
        </div>
        <div>
          <dt>Outstanding</dt>
          <dd>
            {props.snap.outstanding.length} / max {props.snap.maxOutstanding}
          </dd>
        </div>
        <div>
          <dt>Pin words</dt>
          <dd>
            {pins} ({util}% of ticks)
          </dd>
        </div>
        <div>
          <dt>Latency P50</dt>
          <dd>{percentile(latencies, 50) ?? 'n/a'}</dd>
        </div>
        <div>
          <dt>Latency P99</dt>
          <dd>{percentile(latencies, 99) ?? 'n/a'}</dd>
        </div>
        <div>
          <dt>Latency max</dt>
          <dd>{percentile(latencies, 100) ?? 'n/a'}</dd>
        </div>
      </dl>
    </section>
  )
}

function Chart(props: { points: { arch: string; burst: number; ticks: number }[] }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const node = canvas.current
    if (!node) return
    const paint = () => drawChart(node, props.points)
    paint()
    const observer = new ResizeObserver(paint)
    observer.observe(node)
    return () => observer.disconnect()
  }, [props.points])
  return (
    <section>
      <h2>Burst sweep</h2>
      <canvas ref={canvas} className="chart" />
      <p className="caption">Lines are scenarios.csv ticks. Dots are the closed forms.</p>
    </section>
  )
}

function Outstanding(props: { snap: Snapshot; tick: number }) {
  const done = props.snap.requests
    .filter((item) => item.completedAt !== null && item.completedAt <= props.tick)
    .slice()
    .sort((left, right) => (left.completedAt ?? 0) - (right.completedAt ?? 0))
  const reordered = done.some((item, index) => index > 0 && item.id < (done[index - 1]?.id ?? 0))
  return (
    <section>
      <h2>Outstanding</h2>
      <p>{props.snap.outstanding.join(', ') || 'none'}</p>
      <p>{reordered ? `Completion order ${done.map((item) => item.id).join(' ')}` : 'Completions follow request id.'}</p>
    </section>
  )
}

function Requests(props: {
  snap: Snapshot
  other: Snapshot | null
  tick: number
  selected: number | null
  onPick: (id: number, start: number, end: number) => void
}) {
  const rows = props.snap.requests.filter((item) => item.enqueuedAt !== null && item.enqueuedAt <= props.tick)
  return (
    <section className="requests">
      <h2>Requests</h2>
      <ul>
        {rows.map((item) => {
          const twin = props.other?.requests.find((other) => other.id === item.id)
          const queuedAt = item.enqueuedAt ?? 0
          const shown = item.completedAt !== null && item.completedAt <= props.tick
          const doneAt = shown ? item.completedAt : null
          const visibleEnd = doneAt ?? props.tick
          const otherDone = twin && twin.completedAt !== null && twin.completedAt <= props.tick ? twin.completedAt : null
          return (
            <li key={item.id} className={props.selected === item.id ? 'picked' : ''}>
              <button onClick={() => props.onPick(item.id, queuedAt, visibleEnd)}>
                #{item.id} bank {item.bank} row {item.row}
                {doneAt === null ? ' in flight' : ` done ${doneAt - queuedAt}`}
                {otherDone === null ? '' : ` other ${otherDone}`}
              </button>
              {shown ? (
                <div className="stack" title={`rowSpan ${item.rowSpan} colSpan ${item.colSpan} transferSpan ${item.transferSpan} overlap ${item.overlap}`}>
                  <i style={{ flex: item.rowSpan, background: '#e0924a' }}>{item.rowSpan ? `row ${item.rowSpan}` : ''}</i>
                  <i style={{ flex: item.colSpan, background: '#6ea8fe' }}>{item.colSpan ? `col ${item.colSpan}` : ''}</i>
                  <i style={{ flex: Math.max(1, item.transferSpan), background: '#3cba78' }}>{`xfer ${item.transferSpan}`}</i>
                  {item.overlap > 0 ? <b>overlap {item.overlap}</b> : null}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Log(props: {
  events: TraceEvent[]
  tick: number
  kind: string
  onKind: (kind: string) => void
  onJump: (tick: number) => void
}) {
  const rows = props.events
    .filter((event) => event.kind !== 'reqSummary' && event.kind !== 'sim')
    .filter((event) => props.kind === 'all' || event.kind === props.kind)
    .filter((event) => event.tick >= props.tick - 16 && event.tick <= advance(props.tick, 48))
    .slice(0, 200)
  return (
    <section className="log">
      <h2>Events</h2>
      <div className="chips">
        <button className={props.kind === 'all' ? 'on' : ''} onClick={() => props.onKind('all')}>
          all
        </button>
        {KINDS.map((name) => (
          <button key={name} className={props.kind === name ? 'on' : ''} onClick={() => props.onKind(name)}>
            {name}
          </button>
        ))}
      </div>
      <table>
        <tbody>
          {rows.map((event, index) => (
            <tr key={`${event.kind}-${index}`} onClick={() => props.onJump(event.tick)}>
              <td>{event.tick}</td>
              <td>{event.kind}</td>
              <td>{detail(event)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function detail(event: TraceEvent): string {
  if (event.kind === 'cmd') return `${event.decoded} bank ${event.bank}`
  if (event.kind === 'bank') return `bank ${event.bank} ${event.from} -> ${event.to} timer ${event.timer}`
  if (event.kind === 'fifo') return `${event.op} ${event.token ?? 'bubble'}`
  if (event.kind === 'pin') return `word ${event.wordIndex} req ${event.reqId}`
  if (event.kind === 'chan') return `${event.seg} ${event.phase} txn ${event.txnId}`
  if (event.kind === 'outstanding') return `${event.phase} txn ${event.txnId} size ${event.size}`
  if (event.kind === 'halfrow') return `${event.phase} bank ${event.bank}`
  if (event.kind === 'refresh') return `${event.mode} ${event.phase} next ${event.nextEventAt}`
  if (event.kind === 'req') return `#${event.id} ${event.phase}`
  if (event.kind === 'edge') return event.edge
  return event.kind
}
