/*
  리프레시 자명종입니다.
  손님이 없어도 벽시계로 울립니다. 기본값은 꺼짐이고, 실험을 켤 때만 돕니다.
  울리는 틱과 잠금이 풀리는 틱은 분리됩니다.
  commodity 모드는 SDR과 DDR입니다. 남은 시간 동안 집 전체의 새 주문을 멈춥니다.
  bank 모드는 RDRAM입니다. 방 번호가 0, 1, 2처럼 돌아가며 방 하나만 잠급니다. 복도는 잠그지 않습니다.
*/

export type RefreshMode = 'commodity' | 'bank'

export type RefreshScheduler = {
  enabled: boolean
  intervalTicks: number
  busyTicks: number
  nextEventAt: number
  remaining: number
  lockedBank: number | null
  lastBank: number | null
  events: number
  busyTicksTotal: number
  mode: RefreshMode
  bankCount: number
}

/*
  자명종을 만듭니다.
  첫 울림은 intervalTicks 뒤입니다. 처음부터 잠가 두지 않습니다.
  intervalTicks는 다음 울림까지의 벽시계이고, busyTicks는 한 번 울렸을 때의 잠금 길이입니다.
*/
export function makeRefresh(opts: {
  enabled: boolean
  intervalTicks: number
  busyTicks: number
  mode: RefreshMode
  bankCount: number
}): RefreshScheduler {
  return {
    enabled: opts.enabled,
    intervalTicks: opts.intervalTicks,
    busyTicks: opts.busyTicks,
    nextEventAt: opts.intervalTicks,
    remaining: 0,
    lockedBank: null,
    lastBank: null,
    events: 0,
    busyTicksTotal: 0,
    mode: opts.mode,
    bankCount: opts.bankCount,
  }
}

/*
슈도코드
makeRefresh(켜짐, 간격, 바쁜길이, 모드, 방개수):
  다음울림 = 간격
  남은잠금 = 0
  잠근방 = 없음
  반환 그 자명종
*/

/* 집 전체가 새 명령을 받으면 안 되는 틱인지. 켜져 있고, commodity이며, 잠금이 남아 있을 때입니다. */
export function refreshBlocksAll(scheduler: RefreshScheduler): boolean {
  return scheduler.enabled && scheduler.mode === 'commodity' && scheduler.remaining > 0
}

/*
슈도코드
refreshBlocksAll(자명종):
  켜짐이고 모드가 집 전체이고 남은잠금이 0보다 크면 참
*/

/* 이 방 번호만 잠겼는지. RDRAM이 그 방의 표찰을 내기 전에 봅니다. */
export function refreshBlocksBank(scheduler: RefreshScheduler, bank: number): boolean {
  return (
    scheduler.enabled &&
    scheduler.mode === 'bank' &&
    scheduler.remaining > 0 &&
    scheduler.lockedBank === bank
  )
}

/*
슈도코드
refreshBlocksBank(자명종, 방):
  켜짐이고 모드가 방 하나이고 남은잠금이 있고 잠근방이 이 방이면 참
*/

/*
  자명종을 한 틱 진행합니다.
  잠금이 남아 있으면 먼저 1 줄입니다. 0이 되면 잠근 방을 풉니다.
  이번 틱이 예약된 울림이면, 횟수를 올리고 다음 울림을 간격만큼 미룬 뒤
  남은 잠금에 바쁜 길이를 채웁니다.
  bank 모드면 직전 방의 다음 번호를 잠급니다. 방이 16개면 0부터 15를 돕니다.
  같은 틱에 잠금이 끝나면서 다음 울림이 올 수 있습니다. 줄인 뒤에 울림을 검사합니다.
*/
export function tickRefresh(scheduler: RefreshScheduler, tick: number): RefreshScheduler {
  if (!scheduler.enabled) return scheduler
  if (scheduler.remaining === 0 && tick !== scheduler.nextEventAt) return scheduler
  const next: RefreshScheduler = { ...scheduler }
  if (next.remaining > 0) {
    next.remaining -= 1
    if (next.remaining > 0) next.busyTicksTotal += 1
    else next.lockedBank = null
  }
  if (tick !== scheduler.nextEventAt) return next
  next.events += 1
  next.nextEventAt = tick + next.intervalTicks
  next.remaining = next.busyTicks
  next.busyTicksTotal += 1
  if (next.mode === 'bank') {
    const bank = next.lastBank === null ? 0 : (next.lastBank + 1) % next.bankCount
    next.lockedBank = bank
    next.lastBank = bank
  }
  return next
}

/*
슈도코드
tickRefresh(자명종, 지금틱):
  꺼져 있으면 그대로 반환
  잠금이 없고 지금틱이 다음울림도 아니면 그대로 반환
  남은잠금이 있으면
    남은잠금을 1 줄인다
    아직 남았으면 바쁜칸 합계를 1 올린다
    0이 되면 잠근방을 푼다
  지금틱이 다음울림이 아니면 여기까지를 반환
  횟수를 1 올린다
  다음울림 = 지금틱 + 간격
  남은잠금 = 바쁜길이
  모드가 방 하나이면
    다음방 = 처음이면 0, 아니면 (직전방 + 1)을 방개수로 나눈 나머지
    그 방을 잠근다
  반환
*/
