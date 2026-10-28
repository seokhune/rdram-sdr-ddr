/*
  RDRAM의 카트 자리입니다.
  방은 16개인데 자리는 17개입니다. 방 n은 자리 n과 n+1을 같이 씁니다.
  옆 방이 그 자리를 쓰고 있으면 나는 책장을 올리지 못합니다.
  비울 때 자리를 돌려주지 않으면 옆 방이 계속 못 엽니다.
*/

export type HalfRow = {
  readonly slots: ReadonlyArray<boolean>
}

/* 자리 slotCount개를 모두 빈 칸으로 만듭니다. 기본은 17입니다. */
export function makeHalfRow(slotCount = 17): HalfRow {
  return { slots: Array.from({ length: slotCount }, () => false) }
}

/*
슈도코드
makeHalfRow(자리수=17):
  길이 자리수인 빈(거짓) 배열을 반환
*/

/* 방 번호가 쓰는 자리 두 개. 방 0은 자리 0과 1, 방 1은 자리 1과 2입니다. */
export function slotPair(bank: number): [number, number] {
  return [bank, bank + 1]
}

/*
슈도코드
slotPair(방):
  반환 [방, 방+1]
*/

/* 두 자리가 모두 비어 있어야 이 방을 열 수 있습니다. */
export function canActivate(halfRow: HalfRow, bank: number): boolean {
  const [left, right] = slotPair(bank)
  return halfRow.slots[left] === false && halfRow.slots[right] === false
}

/*
슈도코드
canActivate(자리표, 방):
  왼쪽, 오른쪽 = 그 방의 자리 쌍
  둘 다 비어 있으면 참
*/

/* 두 자리를 차지합니다. 이미 차 있으면 undefined입니다. */
export function occupy(halfRow: HalfRow, bank: number): HalfRow | undefined {
  if (!canActivate(halfRow, bank)) return undefined
  const slots = halfRow.slots.slice()
  const [left, right] = slotPair(bank)
  slots[left] = true
  slots[right] = true
  return { slots }
}

/*
슈도코드
occupy(자리표, 방):
  열 수 없으면 실패
  자리 배열을 복사하고 그 방의 두 자리를 참으로 표시
  반환
*/

/* 비울 때 두 자리를 돌려줍니다. */
export function release(halfRow: HalfRow, bank: number): HalfRow {
  const slots = halfRow.slots.slice()
  const [left, right] = slotPair(bank)
  slots[left] = false
  slots[right] = false
  return { slots }
}

/*
슈도코드
release(자리표, 방):
  자리 배열을 복사하고 그 방의 두 자리를 거짓으로 돌린다
  반환
*/
