/*
  DDR이 미리 쥐는 책입니다. 깊이는 2를 넘지 않습니다.
  다음 주소를 짐작해서 쌓아 두는 상자가 아닙니다.
  코어에서 꺼낸 책을 최대 두 칸에 넣고, 문으로 한 권씩 내립니다.
  시계가 올라갈 때 한 권, 내려갈 때 한 권입니다.
*/

export type Prefetch2 = {
  buf: [number | undefined, number | undefined]
  count: 0 | 1 | 2
}

/* 빈 손. 칸 둘 다 비어 있고 권수는 0입니다. */
export function emptyPrefetch(): Prefetch2 {
  return { buf: [undefined, undefined], count: 0 }
}

/*
슈도코드
emptyPrefetch():
  반환 { 칸 [없음, 없음], 권수 0 }
*/

/*
  한 권 또는 두 권을 손에 쥡니다.
  second가 없으면 권수는 1입니다. 있으면 2입니다.
  이전 칸은 덮어씁니다. 호출할 때마다 목록이 길어지지 않습니다.
*/
export function loadPair(
  prefetch: Prefetch2,
  first: number,
  second: number | undefined,
): Prefetch2 {
  const count = second === undefined ? 1 : 2
  return { buf: [first, second], count }
}

/*
슈도코드
loadPair(손, 첫째, 둘째):
  둘째가 없으면 권수 = 1, 있으면 권수 = 2
  반환 { 칸 [첫째, 둘째], 권수 }
*/

/*
  앞칸을 문으로 보내고, 뒷칸을 앞으로 당깁니다.
  손이 비어 있으면 내보낼 번호가 없습니다.
*/
export function shiftOut(prefetch: Prefetch2): {
  prefetch: Prefetch2
  id: number | undefined
} {
  if (prefetch.count === 0) return { prefetch, id: undefined }
  const id = prefetch.buf[0]
  const count = (prefetch.count - 1) as 0 | 1
  return { prefetch: { buf: [prefetch.buf[1], undefined], count }, id }
}

/*
슈도코드
shiftOut(손):
  권수가 0이면 반환 { 손 그대로, 내보낼 번호 없음 }
  내보낼번호 = 앞칸
  새 손 = { 칸 [뒷칸, 없음], 권수-1 }
  반환 { 새 손, 내보낼번호 }
*/
