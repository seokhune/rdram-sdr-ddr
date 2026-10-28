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

export function refreshBlocksAll(scheduler: RefreshScheduler): boolean {
  return scheduler.enabled && scheduler.mode === 'commodity' && scheduler.remaining > 0
}

export function refreshBlocksBank(scheduler: RefreshScheduler, bank: number): boolean {
  return (
    scheduler.enabled &&
    scheduler.mode === 'bank' &&
    scheduler.remaining > 0 &&
    scheduler.lockedBank === bank
  )
}

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
