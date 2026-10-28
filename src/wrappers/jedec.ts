/*
  SDR과 DDR의 한 틱입니다. 도서관 본체는 한 벌이고, 이 파일이 두 문의 차이를 만듭니다.
  명령은 시계가 올라갈 때만 받습니다.
  올라갈 때 SDR은 책을 한 권, DDR도 한 권 꺼냅니다.
  내려갈 때는 DDR만 책을 한 권 더 꺼냅니다. 그래서 같은 10ns 안에 두 권이 나갑니다.
  리프레시가 켜지면 집 전체의 새 주문을 멈추되, 이미 열 줄과 문에 들어간 책은 계속 나갑니다.
*/

import { pickOpenPage } from '../channel/schedule.ts'
import { isRowHit, tryActivate, tryPrecharge } from '../core/bank.ts'
import { makeCore, replaceBank, stepCore, type DramCore } from '../core/dram.ts'
import {
  COMMODITY_REFRESH_INTERVAL_TICKS,
  CUPPU_DDR,
  CUPPU_SDR,
  deviceSteps,
  refreshBusyTicks,
} from '../core/params.ts'
import { makeRefresh, refreshBlocksAll, tickRefresh, type RefreshScheduler } from '../core/refresh.ts'
import { makeDelay, pushDelay, type DelayFifo } from '../gates/delay.ts'
import { makeDivider, stepDivider, type Divider } from '../gates/divider.ts'
import { emptyPrefetch, loadPair, shiftOut, type Prefetch2 } from './prefetch.ts'

export type MemJob = {
  id: number
  bank: number
  row: number
  col: number
  burst: number
}

export type Track = {
  id: number
  enqueuedAt: number
  rowStart: number | null
  rowEnd: number | null
  colStart: number | null
  colEnd: number | null
  firstWord: number | null
  lastWord: number | null
  words: number
  emitted: number
  overlap: number
  transfer: number
  doneAt: number | null
}

type Token = { id: number; words: number }
type PinWord = { id: number; left: number }
type Opening = { id: number; bank: number; row: number; start: number; end: number | null }

export type ManualCmd =
  | { op: 'nop' }
  | { op: 'activate'; bank: number; row: number }
  | { op: 'precharge'; bank: number }
  | { op: 'read'; id: number; bank: number; row: number; col: number; burst: number }

export type Device = {
  kind: 'sdr' | 'ddr'
  period: number
  rowSteps: number
  tRpSteps: number
  core: DramCore
  divider: Divider
  column: DelayFifo<Token | undefined>
  pin: PinWord[]
  prefetch: Prefetch2
  peakPrefetch: number
  queue: MemJob[]
  tracks: Map<number, Track>
  openings: Opening[]
  tick: number
  coreSteps: number
  activates: number
  beats: Array<{ tick: number; id: number }>
  trace: boolean
  manual: boolean
  refresh: RefreshScheduler
}

/* 주문 하나의 시간 기록. 행을 연 틱, 열을 고른 틱, 첫 책과 마지막 책, 겹친 틱을 나중에 채웁니다. */
function blankTrack(job: MemJob, tick: number): Track {
  return {
    id: job.id,
    enqueuedAt: tick,
    rowStart: null,
    rowEnd: null,
    colStart: null,
    colEnd: null,
    firstWord: null,
    lastWord: null,
    words: job.burst,
    emitted: 0,
    overlap: 0,
    transfer: 0,
    doneAt: null,
  }
}

/*
슈도코드
blankTrack(주문, 지금틱):
  들어온틱 = 지금틱
  행시작, 행끝, 열시작, 열끝, 첫책, 마지막책, 끝난틱 = 없음
  권수 = 주문의 버스트
  반환 그 기록
*/

/*
  SDR 또는 DDR 장치를 만듭니다.
  행, 비우기, 열 시간은 전역 틱을 시계로 나눈 장치 걸음입니다.
  열 줄의 깊이가 그 열 걸음입니다. 넣은 값이 그 횟수만큼 밀린 뒤에 문으로 갑니다.
  리프레시 기본은 꺼짐. 켜면 간격 12,500틱, 잠금은 SDR 40틱 또는 DDR 32틱입니다.
*/
export function makeDevice(opts: {
  kind: 'sdr' | 'ddr'
  period?: number
  rowSteps?: number
  tRpSteps?: number
  casClocks?: number
  banks?: number
  manual?: boolean
  trace?: boolean
  refresh?: boolean
  refreshInterval?: number
  refreshBusy?: number
}): Device {
  const defaults = opts.kind === 'sdr' ? CUPPU_SDR : CUPPU_DDR
  const period = opts.period ?? defaults.clock
  const rowSteps = opts.rowSteps ?? deviceSteps(defaults.rowAccess, period)
  const tRpSteps = opts.tRpSteps ?? deviceSteps(defaults.tRp, period)
  const casClocks = opts.casClocks ?? deviceSteps(defaults.colAccess, period)
  return {
    kind: opts.kind,
    period,
    rowSteps,
    tRpSteps,
    core: makeCore(opts.banks ?? defaults.banks),
    divider: makeDivider(period),
    column: makeDelay(casClocks),
    pin: [],
    prefetch: emptyPrefetch(),
    peakPrefetch: 0,
    queue: [],
    tracks: new Map(),
    openings: [],
    tick: 0,
    coreSteps: 0,
    activates: 0,
    beats: [],
    trace: opts.trace ?? false,
    manual: opts.manual ?? false,
    refresh: makeRefresh({
      enabled: opts.refresh ?? false,
      intervalTicks: opts.refreshInterval ?? COMMODITY_REFRESH_INTERVAL_TICKS,
      busyTicks: opts.refreshBusy ?? refreshBusyTicks(opts.kind),
      mode: 'commodity',
      bankCount: opts.banks ?? defaults.banks,
    }),
  }
}

/*
슈도코드
makeDevice(종류, 선택값):
  종류가 SDR이면 Cuppu SDR 표, DDR이면 Cuppu DDR 표
  시계, 행걸음, 비우기걸음, 열걸음은 선택이 없으면 그 표에서 계산
  방, 시계, 열 줄, 빈 손, 빈 대기열을 만든다
  리프레시는 집 전체 모드. 기본은 꺼짐
  반환 장치
*/

/* SDR 장치를 만듭니다. 시계 8틱, 방 4개, 행 3걸음이 기본입니다. */
export function makeSdr(opts?: {
  period?: number
  rowSteps?: number
  tRpSteps?: number
  casClocks?: number
  banks?: number
  manual?: boolean
  trace?: boolean
  refresh?: boolean
  refreshInterval?: number
  refreshBusy?: number
}): Device {
  return makeDevice({ kind: 'sdr', ...opts })
}

/*
슈도코드
makeSdr(선택값):
  makeDevice를 종류 SDR로 호출
*/

/* DDR 장치를 만듭니다. 코어 시계는 SDR과 같고, 하강에서도 책을 꺼냅니다. */
export function makeDdr(opts?: {
  period?: number
  rowSteps?: number
  tRpSteps?: number
  casClocks?: number
  banks?: number
  manual?: boolean
  trace?: boolean
  refresh?: boolean
  refreshInterval?: number
  refreshBusy?: number
}): Device {
  return makeDevice({ kind: 'ddr', ...opts })
}

/*
슈도코드
makeDdr(선택값):
  makeDevice를 종류 DDR로 호출
*/

/* 시험을 위해 방을 이미 열린 상태로 둡니다. 타이머는 0입니다. */
export function primeRow(device: Device, bank: number, row: number): void {
  device.core.banks[bank] = { state: 'active', openRow: row, timer: 0 }
}

/*
슈도코드
primeRow(장치, 방, 행):
  그 방을 { 열림, 그 행, 타이머 0 }으로 둔다
*/

/* 대기열에 주문을 넣고, 시간 기록을 지금 틱으로 시작합니다. */
export function enqueue(device: Device, job: MemJob): void {
  device.queue.push(job)
  device.tracks.set(job.id, blankTrack(job, device.tick))
}

/*
슈도코드
enqueue(장치, 주문):
  대기열 끝에 주문을 넣는다
  그 번호의 시간 기록을 지금 틱으로 만든다
*/

/*
  열 줄을 한 칸 밉니다.
  맨 앞에서 값이 나오면, 그 주문의 남은 권수를 문 대기열에 올립니다.
  토큰이 없어도 줄은 밀립니다. 기다리는 시간이 칸을 미는 횟수이기 때문입니다.
*/
function shiftColumn(device: Device, token: Token | undefined): void {
  const pushed = pushDelay(device.column, token)
  device.column = pushed.fifo
  if (!pushed.out) return
  const track = device.tracks.get(pushed.out.id)
  if (track && track.colStart !== null) track.colEnd = device.tick
  device.pin.push({ id: pushed.out.id, left: pushed.out.words })
}

/*
슈도코드
shiftColumn(장치, 토큰):
  열 줄을 한 칸 밀고 맨 앞 값을 꺼낸다
  꺼낸 값이 없으면 끝
  그 주문의 열 끝 틱을 지금으로 적는다
  문 대기열에 { 번호, 남은권수 }를 넣는다
*/

function markActive(device: Device): void {
  for (const opening of device.openings) {
    if (opening.end !== null) continue
    const bank = device.core.banks[opening.bank]
    if (bank.state === 'active' && bank.openRow === opening.row) opening.end = device.tick
  }
}

/*
슈도코드
markActive(장치):
  아직 끝이 없는 열기 기록마다
    그 방이 요청 행으로 열려 있으면
      끝 틱 = 지금
*/

/*
  이미 열린 행에서 읽기를 시작합니다.
  적중이 아니면 아무것도 하지 않습니다. 행을 다시 열지 않습니다.
  적중이면 열 줄에 { 번호, 권수 }를 넣습니다.
*/
function applyRead(device: Device, id: number, bank: number, row: number, burst: number): void {
  if (!isRowHit(device.core.banks[bank], row)) return
  const track = device.tracks.get(id)
  if (track) {
    track.colStart = device.tick
    const opening = device.openings.find((item) => item.id === id)
    if (opening) {
      track.rowStart = opening.start
      track.rowEnd = opening.end
    }
  }
  shiftColumn(device, { id, words: burst })
  device.queue = device.queue.filter((job) => job.id !== id)
}

/*
슈도코드
applyRead(장치, 번호, 방, 행, 권수):
  그 방이 그 행을 열고 있지 않으면 끝
  열 시작 틱을 적고, 열 줄에 { 번호, 권수 }를 넣는다
  대기열에서 그 주문을 뺀다
*/

/*
  사람이 명령을 한 줄씩 넣는 모드입니다.
  쉼이거나 명령이 없으면 열 줄만 밉니다.
  열기, 비우기, 읽기 중 하나를 방에 적용한 뒤에도, 읽기가 아니면 빈 칸을 밀어 줄을 진행합니다.
*/
function applyManual(device: Device, cmd: ManualCmd | undefined): void {
  if (!cmd || cmd.op === 'nop') {
    shiftColumn(device, undefined)
    return
  }
  if (cmd.op === 'activate') {
    const result = tryActivate(device.core.banks[cmd.bank], cmd.row, device.rowSteps)
    if (!result.blocked && !result.hit) {
      device.core = replaceBank(device.core, cmd.bank, result.bank)
      device.activates += 1
    }
    shiftColumn(device, undefined)
    return
  }
  if (cmd.op === 'precharge') {
    const next = tryPrecharge(device.core.banks[cmd.bank], device.tRpSteps)
    if (next) device.core = replaceBank(device.core, cmd.bank, next)
    shiftColumn(device, undefined)
    return
  }
  applyRead(device, cmd.id, cmd.bank, cmd.row, cmd.burst)
}

/*
슈도코드
applyManual(장치, 명령):
  명령이 없거나 쉼이면
    열 줄에 빈 칸을 밀고 끝
  열기이면
    tryActivate
    새로 열렸으면 그 방으로 갈아 끼운다
    열 줄에 빈 칸을 밀고 끝
  비우기이면
    tryPrecharge가 되면 그 방으로 갈아 끼운다
    열 줄에 빈 칸을 밀고 끝
  읽기이면 applyRead
*/

/*
  자동 스케줄입니다. 열린 행 읽기, 빈 방 열기, 다른 행 비우기 순입니다.
  할 일이 없으면 열 줄만 한 칸 밉니다.
*/
function applyAuto(device: Device): void {
  const choice = pickOpenPage(device.queue, device.core.banks)
  if (!choice) {
    shiftColumn(device, undefined)
    return
  }
  if (choice.act === 'read') {
    applyRead(device, choice.job.id, choice.job.bank, choice.job.row, choice.job.burst)
    return
  }
  if (choice.act === 'activate') {
    const result = tryActivate(device.core.banks[choice.job.bank], choice.job.row, device.rowSteps)
    if (!result.blocked && !result.hit) {
      device.core = replaceBank(device.core, choice.job.bank, result.bank)
      device.activates += 1
      device.openings.push({
        id: choice.job.id,
        bank: choice.job.bank,
        row: choice.job.row,
        start: device.tick,
        end: null,
      })
    }
    shiftColumn(device, undefined)
    return
  }
  const next = tryPrecharge(device.core.banks[choice.job.bank], device.tRpSteps)
  if (next) device.core = replaceBank(device.core, choice.job.bank, next)
  shiftColumn(device, undefined)
}

/*
슈도코드
applyAuto(장치):
  선택 = pickOpenPage(대기열, 방들)
  선택이 없으면 열 줄에 빈 칸을 밀고 끝
  읽기이면 applyRead하고 끝
  열기이면
    새로 열렸으면 방을 갈아 끼우고 열기 기록을 남긴다
    열 줄에 빈 칸을 밀고 끝
  비우기이면 방을 비우기 상태로 바꾸고 열 줄에 빈 칸을 민다
*/

/* 문 밖으로 책 한 권이 나간 틱을 기록합니다. 권수를 다 내면 끝난 틱이 됩니다. */
function emitWord(device: Device, id: number, ticksPerWord: number): void {
  const track = device.tracks.get(id)
  if (track) {
    if (track.firstWord === null) track.firstWord = device.tick
    track.lastWord = device.tick
    track.emitted += 1
    track.transfer += ticksPerWord
    if (track.emitted === track.words) track.doneAt = device.tick
  }
  if (device.trace) device.beats.push({ tick: device.tick, id })
}

/*
슈도코드
emitWord(장치, 번호, 권당틱):
  첫 책 틱이 비어 있으면 지금으로 적는다
  마지막 책 틱 = 지금
  나간 권수를 1 올리고 전송 틱을 더한다
  권수를 다 냈으면 끝난 틱 = 지금
*/

/* 문 대기열의 맨 앞에서 한 권을 꺼냅니다. 그 주문의 남은 권수가 0이면 대기열에서 빠집니다. */
function takePin(device: Device): number | undefined {
  const head = device.pin[0]
  if (!head) return undefined
  const id = head.id
  head.left -= 1
  if (head.left === 0) device.pin.shift()
  return id
}

/*
슈도코드
takePin(장치):
  문 대기열이 비었으면 없음
  맨 앞의 남은 권수를 1 줄인다
  0이 되면 맨 앞을 뺀다
  그 번호를 반환
*/

/* SDR은 상승마다 문에서 한 권만 꺼냅니다. 한 권의 길이는 시계 한 주기입니다. */
function drainSdr(device: Device): void {
  const id = takePin(device)
  if (id === undefined) return
  emitWord(device, id, device.period)
}

/*
슈도코드
drainSdr(장치):
  번호 = takePin
  번호가 있으면 그 책을 권당 시계주기 틱으로 기록
*/

/*
  DDR은 손에 책이 없으면 문 대기열에서 최대 두 권을 집어 듭니다.
  그리고 한 권만 내보냅니다. 상승에서 한 번, 하강에서 한 번 이 함수가 불립니다.
  한 권의 기록 길이는 시계의 절반입니다. 8틱 시계면 4틱입니다.
*/
function drainDdr(device: Device): void {
  if (device.prefetch.count === 0) {
    const first = takePin(device)
    if (first === undefined) return
    const second = takePin(device)
    device.prefetch = loadPair(device.prefetch, first, second)
  }
  if (device.prefetch.count > device.peakPrefetch) device.peakPrefetch = device.prefetch.count
  const shifted = shiftOut(device.prefetch)
  device.prefetch = shifted.prefetch
  if (shifted.id === undefined) return
  emitWord(device, shifted.id, device.period / 2)
}

/*
슈도코드
drainDdr(장치):
  손이 비어 있으면
    문에서 첫째를 집는다. 없으면 끝
    둘째도 집는다. 없을 수 있다
    loadPair로 손에 쥔다
  shiftOut으로 한 권을 내보낸다
  내보낸 번호가 있으면 권당 시계/2 틱으로 기록
*/

/*
  문이 아직 바쁜데 열 줄에 다음 책이 있으면, 그 틱을 겹침으로 셉니다.
  겹침은 공식에 미리 넣지 않고, 줄이 밀리는 동안 문이 바쁘면 쌓입니다.
*/
function noteOverlap(device: Device): void {
  const pinsBusy = device.pin.length > 0 || device.prefetch.count > 0
  if (!pinsBusy) return
  for (const slot of device.column.slots) {
    if (!slot) continue
    const track = device.tracks.get(slot.id)
    if (track) track.overlap += 1
  }
}

/*
슈도코드
noteOverlap(장치):
  문 대기열이나 손이 비어 있으면 끝
  열 줄의 각 칸에 책이 있으면
    그 주문의 겹침 틱을 1 올린다
*/

/*
  장치 한 틱입니다.
  상승에서만 코어가 걷고, 명령을 받고, SDR은 책을 꺼냅니다. DDR도 상승에서 한 권 꺼냅니다.
  DDR은 하강에서 drainDdr을 한 번 더 부릅니다.
  상승도 하강도 아닌 틱에 명령을 넣으면 거절합니다.
  틱을 1 올린 뒤 자명종을 진행합니다. 손님 없어도 벽시계는 흐릅니다.
*/
export function stepDevice(device: Device, cmd?: ManualCmd): Device {
  const edge = stepDivider(device.divider)
  device.divider = edge.divider
  if (edge.rising) {
    device.coreSteps += 1
    device.core = stepCore(device.core)
    markActive(device)
    if (refreshBlocksAll(device.refresh)) shiftColumn(device, undefined)
    else if (device.manual) applyManual(device, cmd)
    else applyAuto(device)
    if (device.kind === 'sdr') drainSdr(device)
    else drainDdr(device)
  } else if (device.kind === 'ddr' && edge.falling) {
    drainDdr(device)
  } else if (cmd && cmd.op !== 'nop') {
    throw new Error('a command is accepted only on a rising edge')
  }
  noteOverlap(device)
  device.tick += 1
  device.refresh = tickRefresh(device.refresh, device.tick)
  return device
}

/*
슈도코드
stepDevice(장치, 명령):
  시계를 한 칸 진행한다
  상승이면
    모든 방의 타이머를 한 걸음 줄인다
    집 전체가 리프레시 중이면 열 줄만 민다
    아니면 수동 명령 또는 자동 스케줄을 적용한다
    SDR이면 drainSdr, DDR이면 drainDdr
  하강이고 DDR이면 drainDdr
  그 밖의 틱에 쉼이 아닌 명령이 있으면 오류
  겹침을 기록한다
  틱을 1 올리고 자명종을 한 틱 진행한다
  반환 장치
*/

/* 다음 상승까지 빈 틱을 걷고, 그 상승에서 명령을 넣습니다. */
export function stepToRising(device: Device, cmd?: ManualCmd): Device {
  while (device.divider.count % device.period !== 0) stepDevice(device)
  return stepDevice(device, cmd)
}

/*
슈도코드
stepToRising(장치, 명령):
  위상이 0이 될 때까지 stepDevice를 빈 명령으로 반복
  그 상승에서 명령과 함께 stepDevice
*/

/* 대기열, 문, 손, 열 줄, 방 타이머가 모두 비면 일이 끝난 것입니다. */
export function isSettled(device: Device): boolean {
  if (device.queue.length > 0) return false
  if (device.pin.length > 0) return false
  if (device.prefetch.count > 0) return false
  if (device.column.slots.some((slot) => slot !== undefined)) return false
  if (device.core.banks.some((bank) => bank.timer > 0)) return false
  return true
}

/*
슈도코드
isSettled(장치):
  대기열, 문, 손, 열 줄, 방 타이머 중 하나라도 남으면 거짓
  모두 비면 참
*/

/* 일이 끝나거나 상한 틱에 닿을 때까지 stepDevice를 반복합니다. */
export function runUntilSettled(device: Device, limit = 200_000): Device {
  let guard = 0
  while (!isSettled(device) && guard < limit) {
    stepDevice(device)
    guard += 1
  }
  if (!isSettled(device)) throw new Error(`${device.kind} run did not settle`)
  return device
}

/*
슈도코드
runUntilSettled(장치, 상한=200000):
  끝나지 않았고 반복이 상한 미만이면 stepDevice
  그래도 안 끝나면 오류
  반환 장치
*/

export const stepSdr = stepDevice
export const stepDdr = stepDevice
