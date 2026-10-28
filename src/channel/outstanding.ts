/*
  아직 끝나지 않은 주문 테이블입니다.
  식당 테이블이 max개면, 그 수를 넘긴 손님은 빈 자리가 날 때까지 기다립니다.
  RDRAM은 makeOutstanding(4)로 부릅니다. 상한 4는 이 코드의 사실입니다.
*/

export type OutTable<T> = {
  byId: Map<number, T>
  max: number
}

/* 빈 테이블. 기본 상한은 4입니다. */
export function makeOutstanding<T>(max = 4): OutTable<T> {
  return { byId: new Map(), max }
}

/*
슈도코드
makeOutstanding(상한=4):
  반환 { 빈 표, 상한 }
*/

/*
  주문을 앉힙니다.
  같은 번호가 이미 있거나, 앉은 수가 상한 이상이면 거절합니다.
*/
export function tryTrack<T>(table: OutTable<T>, id: number, value: T): boolean {
  if (table.byId.has(id)) return false
  if (table.byId.size >= table.max) return false
  table.byId.set(id, value)
  return true
}

/*
슈도코드
tryTrack(테이블, 번호, 값):
  그 번호가 이미 있으면 거절
  앉은 수가 상한 이상이면 거절
  표에 번호를 넣는다
  수락
*/

/* 끝난 주문을 테이블에서 치웁니다. 없던 번호면 undefined입니다. */
export function dropTrack<T>(table: OutTable<T>, id: number): T | undefined {
  const value = table.byId.get(id)
  table.byId.delete(id)
  return value
}

/*
슈도코드
dropTrack(테이블, 번호):
  값을 꺼내 둔다
  표에서 그 번호를 지운다
  값을 반환
*/
