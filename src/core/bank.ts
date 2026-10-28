export type BankStateName = 'idle' | 'rowActivating' | 'active' | 'precharging'

export type Bank = {
  state: BankStateName
  openRow: number | null
  timer: number
}

export function idleBank(): Bank {
  return { state: 'idle', openRow: null, timer: 0 }
}

export function stepBank(bank: Bank): Bank {
  if (bank.timer <= 0) return bank
  const timer = bank.timer - 1
  if (timer > 0) return { ...bank, timer }
  if (bank.state === 'rowActivating') {
    return { state: 'active', openRow: bank.openRow, timer: 0 }
  }
  if (bank.state === 'precharging') {
    return { state: 'idle', openRow: null, timer: 0 }
  }
  return { ...bank, timer: 0 }
}

export function isRowHit(bank: Bank, row: number): boolean {
  return bank.state === 'active' && bank.openRow === row
}

export type ActivateResult =
  | { blocked: true }
  | { blocked: false; hit: true; bank: Bank }
  | { blocked: false; hit: false; bank: Bank }

export function tryActivate(bank: Bank, row: number, rowSteps: number): ActivateResult {
  if (isRowHit(bank, row)) {
    return { blocked: false, hit: true, bank }
  }
  if (bank.state !== 'idle') return { blocked: true }
  return {
    blocked: false,
    hit: false,
    bank: { state: 'rowActivating', openRow: row, timer: rowSteps },
  }
}

export function tryPrecharge(bank: Bank, tRpSteps: number): Bank | undefined {
  if (bank.state !== 'active') return undefined
  return { state: 'precharging', openRow: bank.openRow, timer: tRpSteps }
}
