/*
  방 하나의 상태 기계입니다.
  상태는 한 방향으로만 돕니다.
  쉼(idle) → 책장을 올리는 중(rowActivating) → 열림(active) → 비우는 중(precharging) → 쉼.
  타이머는 장치 걸음 단위입니다. 0이 되는 그 걸음에 상태가 바뀝니다.
  이미 열린 행에는 열기를 다시 내지 않습니다.
*/

export type BankStateName = 'idle' | 'rowActivating' | 'active' | 'precharging'

export type Bank = {
  state: BankStateName
  openRow: number | null
  timer: number
}

/* 비어 있는 방. 열린 행도 없고 타이머도 0입니다. */
export function idleBank(): Bank {
  return { state: 'idle', openRow: null, timer: 0 }
}

/*
슈도코드
idleBank():
  반환 { 상태 쉼, 열린행 없음, 타이머 0 }
*/

/*
  방의 타이머를 한 걸음 줄입니다.
  타이머가 이미 0이면 아무것도 하지 않습니다.
  줄인 결과가 0이고 올리던 중이면 그 걸음에 열린 상태가 됩니다.
  줄인 결과가 0이고 비우던 중이면 그 걸음에 쉼으로 돌아가고 행 번호가 지워집니다.
*/
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

/*
슈도코드
stepBank(방):
  타이머가 0 이하면 방을 그대로 반환
  타이머 = 타이머 - 1
  타이머가 아직 남았으면 그 타이머만 바꿔 반환
  타이머가 0이고 올리던 중이면
    반환 { 열림, 같은 행, 타이머 0 }
  타이머가 0이고 비우던 중이면
    반환 { 쉼, 행 없음, 타이머 0 }
*/

/* 방이 열려 있고, 그 행 번호가 요청과 같으면 적중입니다. */
export function isRowHit(bank: Bank, row: number): boolean {
  return bank.state === 'active' && bank.openRow === row
}

/*
슈도코드
isRowHit(방, 행):
  상태가 열림이고 열린 행이 요청 행과 같으면 참
*/

export type ActivateResult =
  | { blocked: true }
  | { blocked: false; hit: true; bank: Bank }
  | { blocked: false; hit: false; bank: Bank }

/*
  책장을 카트에 올리려는 시도입니다.
  이미 그 행이 열려 있으면 타이머를 시작하지 않고 적중만 돌려줍니다.
  방이 쉼이 아니면 카트가 바쁘므로 거절합니다.
  쉼이면 올리는 중으로 바꾸고, 타이머에 행 걸음 수를 넣습니다.
*/
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

/*
슈도코드
tryActivate(방, 행, 행걸음):
  이미 그 행이 열려 있으면
    반환 { 막히지 않음, 적중, 방 그대로 }
  방이 쉼이 아니면
    반환 { 막힘 }
  반환 { 막히지 않음, 적중 아님, 상태=올리는 중, 행, 타이머=행걸음 }
*/

/*
  카트를 비웁니다. 열려 있는 방에서만 받습니다.
  타이머에 비우기 걸음(tRP를 장치 시계로 나눈 값)을 넣습니다.
  받을 수 없으면 undefined입니다.
*/
export function tryPrecharge(bank: Bank, tRpSteps: number): Bank | undefined {
  if (bank.state !== 'active') return undefined
  return { state: 'precharging', openRow: bank.openRow, timer: tRpSteps }
}

/*
슈도코드
tryPrecharge(방, 비우기걸음):
  상태가 열림이 아니면 실패
  반환 { 비우는 중, 같은 행, 타이머=비우기걸음 }
*/
