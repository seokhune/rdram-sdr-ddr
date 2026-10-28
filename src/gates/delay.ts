/*
  기다리는 줄입니다.
  시간은 "지금 + k"로 적지 않고, 깊이 k인 칸을 한 틱마다 한 칸씩 밉니다.
  넣은 값은 k번 밀린 뒤에 맨 앞에서 나옵니다.
  앞사람이 복도를 쓰는 동안에도 이 줄은 계속 밀리므로, 일이 겹칩니다.
*/

export type DelayFifo<T> = {
  readonly depth: number
  readonly slots: ReadonlyArray<T | undefined>
}

/* 빈 줄 k칸을 만듭니다. k는 1 이상의 정수여야 합니다. */
export function makeDelay<T>(k: number): DelayFifo<T> {
  if (!Number.isInteger(k) || k < 1) {
    throw new Error(`delay depth must be an integer >= 1, got ${k}`)
  }
  return { depth: k, slots: Array.from({ length: k }, () => undefined) }
}

/*
슈도코드
makeDelay(k):
  k가 1 이상의 정수가 아니면 오류
  길이 k인 빈 칸 배열을 반환
*/

/*
  줄을 한 칸 밉니다.
  맨 앞 칸이 이번 틱에 나오는 값이고, 새 값은 맨 뒤에 들어갑니다.
  빈 칸(undefined)을 넣으면 줄은 밀리되 나오는 값은 없습니다.
*/
export function pushDelay<T>(
  fifo: DelayFifo<T>,
  value: T | undefined,
): { fifo: DelayFifo<T>; out: T | undefined } {
  const out = fifo.slots[0]
  const slots = fifo.slots.slice(1)
  slots.push(value)
  return { fifo: { depth: fifo.depth, slots }, out }
}

/*
슈도코드
pushDelay(줄, 새값):
  나가는값 = 줄의 맨 앞
  나머지 칸을 한 칸 앞으로 당긴다
  새값을 맨 뒤에 넣는다
  반환 (새 줄, 나가는값)
*/
