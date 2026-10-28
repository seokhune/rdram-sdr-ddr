/*
  Direct RDRAM의 한 틱입니다.
  명령을 핀 네 개로 받지 않고, 복도에 표찰을 먼저 붙입니다.
  표찰은 기본 8틱입니다. 표찰이 복도를 쓰는 동안 같은 선으로 데이터를 보내지 않습니다.
  책장이 닫혀 있으면 행 표찰, 이미 열려 있으면 열 표찰부터 갑니다.
  동시에 앉힐 수 있는 주문은 4개입니다. 다섯 번째는 자리가 날 때까지 기다립니다.
  방 16개가 카트 자리 17개를 나눕니다. 옆 방이 자리를 쓰면 열기가 거절됩니다.
  리프레시는 방 하나만 잠급니다. 복도는 잠그지 않습니다. 간격의 기본은 1,562틱, 잠금 길이는 30틱입니다.
  코어는 자기 시계(2틱)의 상승에서만 걷습니다. 복도의 남은 칸은 매 틱 줄어듭니다.
*/

import { dropTrack, makeOutstanding, tryTrack, type OutTable } from '../channel/outstanding.ts'
import { isRowHit, tryActivate, tryPrecharge, type Bank } from '../core/bank.ts'
import { makeCore, replaceBank, stepCore, type DramCore } from '../core/dram.ts'
import {
  CUPPU_RDRAM,
  HALF_ROW_SLOTS,
  OCTCYCLE_TICKS,
  RAMBUS_REFRESH_INTERVAL_TICKS,
  deviceSteps,
  refreshBusyTicks,
} from '../core/params.ts'
import { makeRefresh, refreshBlocksBank, tickRefresh, type RefreshScheduler } from '../core/refresh.ts'
import { canActivate, makeHalfRow, occupy, release, slotPair, type HalfRow } from '../core/halfRow.ts'
import { makeDelay, pushDelay, type DelayFifo } from '../gates/delay.ts'
import { makeDivider, stepDivider, type Divider } from '../gates/divider.ts'

export type RdramJob = {
  id: number
  bank: number
  row: number
  col: number
  burst: number
}

/*
  주문 하나가 복도와 방을 거치는 단계입니다.
  needRow      행 표찰이 필요함
  rowHeader    행 표찰이 복도를 차지하는 중
  actPending   표찰이 끝나 책장을 올릴 차례
  activating   방이 책장을 올리는 중
  needPre      다른 행이 열려 있어 비워야 함
  precharging  비우는 중
  waitBank     방이 다른 일로 바쁨
  needCol      열 표찰이 필요함. 행 적중이면 여기서 시작
  colHeader    열 표찰이 복도를 차지하는 중
  colPending   표찰이 끝나 열 줄에 넣을 차례
  inColumn     열 줄에서 기다리는 중
  ready        데이터를 복도로 낼 준비
  data         데이터 묶음이 복도를 차지하는 중
*/
type Stage =
  | 'needRow'
  | 'rowHeader'
  | 'actPending'
  | 'activating'
  | 'needPre'
  | 'precharging'
  | 'waitBank'
  | 'needCol'
  | 'colHeader'
  | 'colPending'
  | 'inColumn'
  | 'ready'
  | 'data'

export type RdramTxn = {
  id: number
  bank: number
  row: number
  col: number
  burst: number
  stage: Stage
  enqueuedAt: number
  rowStart: number | null
  rowEnd: number | null
  colStart: number | null
  colEnd: number | null
  firstWord: number | null
  lastWord: number | null
  overlap: number
  transfer: number
  chunksLeft: number
  doneAt: number | null
}

/*
  복도는 한 방향입니다.
  쉼, 표찰(ROW 또는 COL), 데이터 중 하나만 됩니다.
  left는 그 점유가 끝나기까지 남은 틱입니다.
*/
type Channel =
  | { mode: 'idle' }
  | { mode: 'header'; left: number; id: number; which: 'ROW' | 'COL'; start: number }
  | { mode: 'data'; left: number; id: number; start: number }

export type Occupation = {
  id: number
  kind: 'ROW' | 'COL' | 'DATA'
  start: number
  end: number
}

type Token = { id: number }

export type Rdram = {
  core: DramCore
  halfRow: HalfRow
  divider: Divider
  column: DelayFifo<Token | undefined>
  outstanding: OutTable<RdramTxn>
  channel: Channel
  finished: RdramTxn[]
  occupations: Occupation[]
  tick: number
  coreSteps: number
  activates: number
  headerOctcycles: number
  rowSteps: number
  tRpSteps: number
  channelIdle: number
  headerBusy: number
  dataBusy: number
  onDone: Map<number, (txn: RdramTxn) => void>
  refresh: RefreshScheduler
}

/*
  RDRAM 장치를 만듭니다.
  방 16, 카트 자리 17, 시계 2틱, 앉을 수 있는 주문 4가 기본입니다.
  행 14틱은 시계 2로 나누면 7걸음, 열 24틱은 12걸음, 비우기 16틱은 8걸음입니다.
  표찰 길이는 headerOctcycles × 8틱이고 기본 옥트사이클은 1입니다.
*/
export function makeRdram(opts?: {
  headerOctcycles?: number
  rowSteps?: number
  tRpSteps?: number
  casClocks?: number
  onDone?: (txn: RdramTxn) => void
  refresh?: boolean
  refreshInterval?: number
  refreshBusy?: number
}): Rdram {
  const headerOctcycles = opts?.headerOctcycles ?? 1
  if (!Number.isInteger(headerOctcycles) || headerOctcycles < 1) {
    throw new Error('headerOctcycles must be an integer >= 1')
  }
  const rowSteps = opts?.rowSteps ?? deviceSteps(CUPPU_RDRAM.rowAccess, CUPPU_RDRAM.clock)
  const tRpSteps = opts?.tRpSteps ?? deviceSteps(CUPPU_RDRAM.tRp, CUPPU_RDRAM.clock)
  const casClocks = opts?.casClocks ?? deviceSteps(CUPPU_RDRAM.colAccess, CUPPU_RDRAM.clock)
  return {
    core: makeCore(CUPPU_RDRAM.banks),
    halfRow: makeHalfRow(HALF_ROW_SLOTS),
    divider: makeDivider(CUPPU_RDRAM.clock),
    column: makeDelay(casClocks),
    outstanding: makeOutstanding(4),
    channel: { mode: 'idle' },
    finished: [],
    occupations: [],
    tick: 0,
    coreSteps: 0,
    activates: 0,
    headerOctcycles,
    rowSteps,
    tRpSteps,
    channelIdle: 0,
    headerBusy: 0,
    dataBusy: 0,
    onDone: new Map(),
    refresh: makeRefresh({
      enabled: opts?.refresh ?? false,
      intervalTicks: opts?.refreshInterval ?? RAMBUS_REFRESH_INTERVAL_TICKS,
      busyTicks: opts?.refreshBusy ?? refreshBusyTicks('rdram'),
      mode: 'bank',
      bankCount: CUPPU_RDRAM.banks,
    }),
  }
}

/*
슈도코드
makeRdram(선택값):
  표찰 옥트사이클은 없으면 1. 1 미만이면 오류
  행걸음, 비우기걸음, 열걸음은 Cuppu RDRAM 표를 시계 2로 나눈 값
  방 16, 자리 17, 시계 2, 주문표 상한 4, 복도 쉼
  리프레시는 방 하나 모드. 기본 간격 1562, 바쁜 길이 30. 기본은 꺼짐
  반환 장치
*/

/* 시험을 위해 자리를 차지하고 그 방을 이미 연 상태로 둡니다. 자리가 없으면 오류입니다. */
export function openRow(rdram: Rdram, bank: number, row: number): void {
  const held = occupy(rdram.halfRow, bank)
  if (!held) throw new Error(`bank ${bank} cannot open`)
  rdram.halfRow = held
  rdram.core.banks[bank] = { state: 'active', openRow: row, timer: 0 }
}

/*
슈도코드
openRow(장치, 방, 행):
  그 방의 자리 두 개를 차지한다. 실패하면 오류
  방을 { 열림, 그 행, 타이머 0 }으로 둔다
*/

/* 주문 하나의 빈 시간 기록입니다. 단계와 들어온 틱만 먼저 채웁니다. */
function blankTxn(job: RdramJob, tick: number, stage: Stage): RdramTxn {
  return {
    id: job.id,
    bank: job.bank,
    row: job.row,
    col: job.col,
    burst: job.burst,
    stage,
    enqueuedAt: tick,
    rowStart: null,
    rowEnd: null,
    colStart: null,
    colEnd: null,
    firstWord: null,
    lastWord: null,
    overlap: 0,
    transfer: 0,
    chunksLeft: 0,
    doneAt: null,
  }
}

/*
슈도코드
blankTxn(주문, 지금틱, 단계):
  번호, 방, 행, 열, 권수, 단계를 적는다
  들어온틱 = 지금틱
  행, 열, 첫책, 마지막책, 끝난틱은 없음
  남은묶음 = 0
  반환
*/

/*
  주문이 어느 단계에서 시작할지 정합니다.
  그 행이 이미 열려 있으면 열 표찰부터입니다. 행 표찰을 다시 붙이지 않습니다.
  다른 행이 열려 있으면 먼저 비워야 합니다.
  방이 쉼이면 행 표찰부터, 올리거나 비우는 중이면 방이 빌 때까지 기다립니다.
*/
function initialStage(rdram: Rdram, job: RdramJob): Stage {
  const bank = rdram.core.banks[job.bank]
  if (isRowHit(bank, job.row)) return 'needCol'
  if (bank.state === 'active') return 'needPre'
  if (bank.state === 'idle') return 'needRow'
  return 'waitBank'
}

/*
슈도코드
initialStage(장치, 주문):
  그 방이 요청 행을 열었으면 needCol
  다른 행이 열려 있으면 needPre
  방이 쉼이면 needRow
  그 외에는 waitBank
*/

/*
  대기열에서 주문 하나를 테이블에 앉힙니다.
  이미 4개가 앉아 있으면 거절합니다.
  고르는 순서는 이미 열린 행, 그 다음 자리까지 비어 있는 쉼 방, 그것도 없으면 처음 본 주문입니다.
*/
export function pullRequest(rdram: Rdram, queue: RdramJob[]): boolean {
  if (rdram.outstanding.byId.size >= rdram.outstanding.max) return false
  let fallback = -1
  for (let index = 0; index < queue.length; index += 1) {
    const job = queue[index]
    const bank = rdram.core.banks[job.bank]
    if (isRowHit(bank, job.row)) {
      const [picked] = queue.splice(index, 1)
      return accept(rdram, picked)
    }
    if (fallback < 0) fallback = index
    if (bank.state === 'idle' && canActivate(rdram.halfRow, job.bank)) {
      const [picked] = queue.splice(index, 1)
      return accept(rdram, picked)
    }
  }
  if (fallback < 0) return false
  const [picked] = queue.splice(fallback, 1)
  return accept(rdram, picked)
}

/*
슈도코드
pullRequest(장치, 대기열):
  앉은 수가 상한이면 거절
  대기열을 앞에서부터
    행 적중이면 그 주문을 빼서 accept하고 끝
    처음 본 주문의 위치를 기억한다
    방이 쉼이고 카트 자리를 쓸 수 있으면 그 주문을 빼서 accept하고 끝
  기억한 주문이 있으면 그것을 accept
  대기열이 비었으면 거절
*/

/*
  주문 하나를 테이블에 앉힙니다.
  같은 번호가 있거나 테이블이 가득하면 거절합니다.
*/
export function accept(rdram: Rdram, job: RdramJob, onDone?: (txn: RdramTxn) => void): boolean {
  const txn = blankTxn(job, rdram.tick, initialStage(rdram, job))
  if (!tryTrack(rdram.outstanding, job.id, txn)) return false
  if (onDone) rdram.onDone.set(job.id, onDone)
  return true
}

/*
슈도코드
accept(장치, 주문, 끝났을때):
  시작 단계를 정하고 빈 기록을 만든다
  tryTrack이 거절하면 거짓
  끝났을 때 부를 함수가 있으면 저장한다
  참
*/

/* 지금 앉아 있는 주문 목록입니다. */
function txns(rdram: Rdram): RdramTxn[] {
  return [...rdram.outstanding.byId.values()]
}

/*
슈도코드
txns(장치):
  주문표의 값들을 배열로 반환
*/

/* 데이터 묶음을 다 내면 끝난 틱을 적고 테이블에서 치웁니다. */
function finish(rdram: Rdram, txn: RdramTxn): void {
  txn.doneAt = rdram.tick
  txn.lastWord = rdram.tick
  rdram.finished.push(txn)
  dropTrack(rdram.outstanding, txn.id)
  const callback = rdram.onDone.get(txn.id)
  rdram.onDone.delete(txn.id)
  callback?.(txn)
}

/*
슈도코드
finish(장치, 주문):
  끝난틱과 마지막책 틱 = 지금
  끝난 목록에 넣고 테이블에서 뺀다
  끝났을 때 부를 함수가 있으면 호출한다
*/

/* 복도 점유가 끝나는 틱을 기록합니다. 두 구간이 겹치면 테스트가 실패합니다. */
function closeOccupation(rdram: Rdram): void {
  const channel = rdram.channel
  if (channel.mode === 'idle') return
  const kind = channel.mode === 'data' ? 'DATA' : channel.which
  rdram.occupations.push({ id: channel.id, kind, start: channel.start, end: rdram.tick })
}

/*
슈도코드
closeOccupation(장치):
  복도가 쉼이면 끝
  종류 = 데이터면 DATA, 표찰이면 ROW 또는 COL
  점유 기록에 { 번호, 종류, 시작틱, 끝틱=지금 }을 넣는다
*/

/* 복도 점유가 0이 되었을 때 다음 단계로 넘깁니다. */
function completeChannel(rdram: Rdram): void {
  const channel = rdram.channel
  closeOccupation(rdram)
  if (channel.mode === 'header') {
    const txn = rdram.outstanding.byId.get(channel.id)
    if (txn) txn.stage = channel.which === 'ROW' ? 'actPending' : 'colPending'
  }
  if (channel.mode === 'data') {
    const txn = rdram.outstanding.byId.get(channel.id)
    if (txn) {
      txn.lastWord = rdram.tick
      if (txn.chunksLeft === 0) finish(rdram, txn)
      else txn.stage = 'ready'
    }
  }
  rdram.channel = { mode: 'idle' }
}

/*
슈도코드
completeChannel(장치):
  점유 끝을 기록한다
  행 표찰이었으면 단계를 actPending으로
  열 표찰이었으면 단계를 colPending으로
  데이터였으면
    마지막책 틱 = 지금
    남은 묶음이 0이면 주문을 끝내고, 아니면 ready로 둔다
  복도를 쉼으로 둔다
*/

/*
  표찰이 복도를 차지하기 시작합니다.
  길이는 옥트사이클 수 × 8틱입니다. 기본은 8틱입니다.
*/
function startHeader(rdram: Rdram, txn: RdramTxn, which: 'ROW' | 'COL'): void {
  const left = rdram.headerOctcycles * OCTCYCLE_TICKS
  rdram.channel = { mode: 'header', left, id: txn.id, which, start: rdram.tick }
  txn.stage = which === 'ROW' ? 'rowHeader' : 'colHeader'
}

/*
슈도코드
startHeader(장치, 주문, 종류):
  남은틱 = 옥트사이클 × 8
  복도 = { 표찰, 남은틱, 주문번호, 종류, 시작=지금 }
  단계 = 행이면 rowHeader, 열이면 colHeader
*/

/* 리프레시가 이 방만 잠그고 있는지. 잠긴 방에는 표찰을 내지 않습니다. */
function bankLocked(rdram: Rdram, bank: number): boolean {
  return refreshBlocksBank(rdram.refresh, bank)
}

/*
슈도코드
bankLocked(장치, 방):
  리프레시가 방 하나 모드로 이 방을 잠그고 있으면 참
*/

/*
  복도가 비었을 때 다음에 올릴 일을 고릅니다.
  이미 준비된 데이터 묶음을 먼저 냅니다.
  그 다음 열린 행의 열 표찰, 그 다음 빈 방의 행 표찰입니다.
  잠긴 방과, 카트 자리가 없는 방은 건너뜁니다.
*/
function tryAssign(rdram: Rdram): boolean {
  for (const txn of txns(rdram)) {
    if (txn.stage === 'ready' && txn.chunksLeft > 0) {
      txn.chunksLeft -= 1
      txn.stage = 'data'
      if (txn.firstWord === null) txn.firstWord = rdram.tick
      rdram.channel = { mode: 'data', left: OCTCYCLE_TICKS, id: txn.id, start: rdram.tick }
      return true
    }
  }
  for (const txn of txns(rdram)) {
    if (txn.stage === 'needCol' && isRowHit(rdram.core.banks[txn.bank], txn.row)) {
      if (bankLocked(rdram, txn.bank)) continue
      startHeader(rdram, txn, 'COL')
      return true
    }
  }
  for (const txn of txns(rdram)) {
    if (txn.stage !== 'needRow') continue
    if (bankLocked(rdram, txn.bank)) continue
    if (rdram.core.banks[txn.bank].state !== 'idle') continue
    if (!canActivate(rdram.halfRow, txn.bank)) continue
    startHeader(rdram, txn, 'ROW')
    return true
  }
  return false
}

/*
슈도코드
tryAssign(장치):
  단계가 ready이고 남은 묶음이 있으면
    묶음을 1 줄이고 단계를 data로
    첫 책 틱이 비어 있으면 지금으로 적는다
    복도를 데이터 8틱으로 잡고 참
  단계가 needCol이고 행 적중이면
    그 방이 잠겼으면 건너뛴다
    열 표찰을 시작하고 참
  단계가 needRow이고 방이 쉼이고 자리를 쓸 수 있으면
    그 방이 잠겼으면 건너뛴다
    행 표찰을 시작하고 참
  없으면 거짓
*/

/* 방을 비우고 카트 자리 두 개를 돌려줍니다. 그 방을 기다리던 주문을 비우는 중으로 바꿉니다. */
function prechargeBank(rdram: Rdram, bankIndex: number): boolean {
  const next = tryPrecharge(rdram.core.banks[bankIndex], rdram.tRpSteps)
  if (!next) return false
  rdram.core = replaceBank(rdram.core, bankIndex, next)
  rdram.halfRow = release(rdram.halfRow, bankIndex)
  for (const txn of txns(rdram)) {
    if (txn.bank === bankIndex && txn.stage === 'needCol') txn.stage = 'needPre'
    if (txn.bank === bankIndex && txn.stage === 'needPre') txn.stage = 'precharging'
  }
  return true
}

/*
슈도코드
prechargeBank(장치, 방):
  tryPrecharge가 실패하면 거짓
  그 방을 비우는 중으로 바꾸고 자리 두 개를 돌려준다
  그 방을 쓰는 주문의 needCol, needPre를 precharging으로 바꾼다
  참
*/

/*
  내가 행을 열고 싶은데 옆 방이 자리를 잡고 있으면, 손님이 없는 옆 방을 비워 자리를 만듭니다.
  그 옆 방이 리프레시로 잠겨 있으면 비우지 않습니다.
*/
function unblockNeighbor(rdram: Rdram): void {
  for (const txn of txns(rdram)) {
    if (txn.stage !== 'needRow') continue
    if (canActivate(rdram.halfRow, txn.bank)) continue
    const [left, right] = slotPair(txn.bank)
    for (let other = 0; other < rdram.core.banks.length; other += 1) {
      if (other === txn.bank) continue
      const holdsLeft = other === left || other + 1 === left
      const holdsRight = other === right || other + 1 === right
      if (!holdsLeft && !holdsRight) continue
      const bank = rdram.core.banks[other]
      if (bank.state !== 'active') continue
      if (txns(rdram).some((held) => held.bank === other)) continue
      if (bankLocked(rdram, other)) continue
      if (prechargeBank(rdram, other)) return
    }
  }
}

/*
슈도코드
unblockNeighbor(장치):
  needRow인데 자리를 못 쓰는 주문마다
    그 자리 쌍을 잡고 있는 다른 방을 찾는다
    그 방이 열려 있고, 앉은 주문이 없고, 리프레시로 잠기지 않았으면
      그 방을 비우고 끝
*/

/*
  코어 시계가 올라갈 때 한 번 돕니다.
  모든 방 타이머를 한 걸음 줄인 뒤, 끝난 비우기와 열기를 다음 단계로 넘깁니다.
  행 표찰이 끝난 주문은 자리를 차지하고 책장 올리기를 시작합니다.
  다른 행이 열린 주문은 그 방을 비웁니다.
  열 표찰이 끝난 주문은 열 줄에 넣습니다. 줄에서 나온 주문은 데이터 준비 상태가 됩니다.
  남은 묶음 수는 권수를 2로 나눈 올림입니다. 8바이트 하나와 16바이트 둘은 묶음 수가 같을 수 있습니다.
*/
function onCore(rdram: Rdram): void {
  rdram.core = stepCore(rdram.core)
  rdram.coreSteps += 1
  for (const txn of txns(rdram)) {
    const bank: Bank = rdram.core.banks[txn.bank]
    if ((txn.stage === 'precharging' || txn.stage === 'waitBank') && bank.state === 'idle') {
      txn.stage = 'needRow'
    }
    if (txn.stage === 'activating' && bank.state === 'active' && bank.openRow === txn.row) {
      txn.rowEnd = rdram.tick
      txn.stage = 'needCol'
    }
    if ((txn.stage === 'needRow' || txn.stage === 'waitBank') && bank.state === 'active') {
      txn.stage = bank.openRow === txn.row ? 'needCol' : 'needPre'
    }
  }
  for (const txn of txns(rdram)) {
    if (txn.stage !== 'actPending') continue
    if (bankLocked(rdram, txn.bank)) continue
    if (rdram.core.banks[txn.bank].state !== 'idle') continue
    if (!canActivate(rdram.halfRow, txn.bank)) continue
    const held = occupy(rdram.halfRow, txn.bank)
    if (!held) continue
    const result = tryActivate(rdram.core.banks[txn.bank], txn.row, rdram.rowSteps)
    if (result.blocked || result.hit) continue
    rdram.halfRow = held
    rdram.core = replaceBank(rdram.core, txn.bank, result.bank)
    rdram.activates += 1
    txn.stage = 'activating'
    txn.rowStart = rdram.tick
    break
  }
  for (const txn of txns(rdram)) {
    if (txn.stage !== 'needPre') continue
    if (bankLocked(rdram, txn.bank)) continue
    const bank = rdram.core.banks[txn.bank]
    if (bank.state !== 'active' || bank.openRow === txn.row) continue
    const busy = txns(rdram).some(
      (other) => other.bank === txn.bank && other.id !== txn.id && other.stage !== 'needPre',
    )
    if (busy) continue
    if (prechargeBank(rdram, txn.bank)) break
  }
  unblockNeighbor(rdram)
  let token: Token | undefined
  for (const txn of txns(rdram)) {
    if (txn.stage !== 'colPending') continue
    if (bankLocked(rdram, txn.bank)) continue
    if (!isRowHit(rdram.core.banks[txn.bank], txn.row)) continue
    token = { id: txn.id }
    txn.stage = 'inColumn'
    txn.colStart = rdram.tick
    break
  }
  const pushed = pushDelay(rdram.column, token)
  rdram.column = pushed.fifo
  if (!pushed.out) return
  const done = rdram.outstanding.byId.get(pushed.out.id)
  if (!done) return
  done.colEnd = rdram.tick
  done.chunksLeft = Math.ceil(done.burst / 2)
  done.stage = 'ready'
}

/*
슈도코드
onCore(장치):
  모든 방 타이머를 한 걸음 줄인다
  비우기가 끝나 방이 쉼이면 단계를 needRow로
  책장 올리기가 끝나 그 행이 열렸으면 단계를 needCol로, 행 끝 틱을 적는다
  행 표찰이 끝난 주문이 있고 방이 쉼이고 자리를 쓸 수 있으면
    자리를 차지하고 tryActivate
    단계를 activating으로, 행 시작 틱을 지금으로
  다른 행이 열려 있고 그 방에 다른 일이 없으면 그 방을 비운다
  옆 방이 자리를 막고 있으면 손님이 없는 옆 방을 비운다
  열 표찰이 끝났고 행 적중이면 열 줄에 그 번호를 넣는다
  열 줄을 한 칸 민다
  맨 앞에서 나온 주문은
    열 끝 틱 = 지금
    남은묶음 = 올림(권수 / 2)
    단계 = ready
*/

/* 복도가 데이터를 나르는 동안 열 줄에 다음 책이 있으면, 그 틱을 겹침으로 셉니다. */
function noteOverlap(rdram: Rdram): void {
  if (rdram.channel.mode !== 'data') return
  for (const slot of rdram.column.slots) {
    if (!slot) continue
    const txn = rdram.outstanding.byId.get(slot.id)
    if (txn) txn.overlap += 1
  }
}

/*
슈도코드
noteOverlap(장치):
  복도가 데이터가 아니면 끝
  열 줄의 각 칸에 책이 있으면 그 주문의 겹침을 1 올린다
*/

/*
  RDRAM 한 틱입니다.
  상승에서만 코어가 걷습니다. 복도가 비어 있으면 다음 표찰이나 데이터를 올립니다.
  복도가 바쁘면 남은 칸을 1 줄이고, 0이 되면 점유를 끝냅니다.
  틱을 올린 뒤 자명종을 진행합니다. 손님이 없어도 벽시계는 흐릅니다.
*/
export function stepRdram(rdram: Rdram): Rdram {
  const edge = stepDivider(rdram.divider)
  rdram.divider = edge.divider
  if (edge.rising) onCore(rdram)
  if (rdram.channel.mode === 'idle') tryAssign(rdram)
  if (rdram.channel.mode === 'idle') rdram.channelIdle += 1
  else {
    if (rdram.channel.mode === 'header') rdram.headerBusy += 1
    else rdram.dataBusy += 1
    rdram.channel.left -= 1
    if (rdram.channel.left === 0) completeChannel(rdram)
  }
  noteOverlap(rdram)
  rdram.tick += 1
  rdram.refresh = tickRefresh(rdram.refresh, rdram.tick)
  return rdram
}

/*
슈도코드
stepRdram(장치):
  시계를 한 칸 진행한다
  상승이면 onCore
  복도가 쉼이면 tryAssign
  그래도 쉼이면 쉼 틱을 1 올린다
  표찰이나 데이터면
    그 바쁜 틱을 1 올리고 남은 칸을 1 줄인다
    남은 칸이 0이면 completeChannel
  겹침을 기록한다
  틱을 1 올리고 자명종을 한 틱 진행한다
  반환 장치
*/

/* 앉은 주문, 복도, 열 줄이 모두 비면 일이 끝난 것입니다. */
export function isSettled(rdram: Rdram): boolean {
  if (rdram.outstanding.byId.size > 0) return false
  if (rdram.channel.mode !== 'idle') return false
  if (rdram.column.slots.some((slot) => slot !== undefined)) return false
  return true
}

/*
슈도코드
isSettled(장치):
  앉은 주문이 있거나 복도가 쉼이 아니거나 열 줄에 값이 있으면 거짓
  모두 비면 참
*/

/* 일이 끝나거나 상한 틱에 닿을 때까지 stepRdram을 반복합니다. */
export function runUntilSettled(rdram: Rdram, limit = 200_000): Rdram {
  let guard = 0
  while (!isSettled(rdram) && guard < limit) {
    stepRdram(rdram)
    guard += 1
  }
  if (!isSettled(rdram)) {
    const stages = txns(rdram)
      .map((txn) => `${txn.id}:${txn.stage}@b${txn.bank}`)
      .join(', ')
    throw new Error(`RDRAM run did not settle (${stages || 'no txn'}, channel ${rdram.channel.mode})`)
  }
  return rdram
}

/*
슈도코드
runUntilSettled(장치, 상한=200000):
  끝나지 않았고 반복이 상한 미만이면 stepRdram
  그래도 안 끝나면, 남은 단계와 복도 상태를 적어 오류
  반환 장치
*/

/* 끝난 주문의 바이트. 권수 × 8바이트입니다. 화면의 대역폭이 이 합을 틱으로 나눕니다. */
export function payloadBytes(txnsFinished: readonly RdramTxn[]): number {
  return txnsFinished.reduce((sum, txn) => sum + txn.burst * 8, 0)
}

/*
슈도코드
payloadBytes(끝난주문들):
  각 주문의 권수 × 8을 더해 반환
*/
