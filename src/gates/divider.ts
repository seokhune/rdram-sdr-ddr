/*
  장치 시계입니다.
  전역 틱이 매 칸 흐르는 동안, 코어는 자기 주기마다만 깨어납니다.
  SDR과 DDR의 주기는 8틱(10ns). RDRAM의 주기는 2틱(2.5ns).
  나머지가 0이면 올라가는 순간, 짝수 주기의 한가운데면 내려가는 순간입니다.
  DDR만 내려가는 순간에도 데이터를 꺼냅니다.
*/

export type Divider = {
  readonly period: number
  readonly count: number
}

export type DividerEdge = {
  divider: Divider
  rising: boolean
  falling: boolean
}

/* 주기 period인 시계를 0에서 시작합니다. */
export function makeDivider(period: number): Divider {
  if (!Number.isInteger(period) || period < 1) {
    throw new Error(`divider period must be an integer >= 1, got ${period}`)
  }
  return { period, count: 0 }
}

/*
슈도코드
makeDivider(주기):
  주기가 1 이상의 정수가 아니면 오류
  반환 { 주기, 센칸 0 }
*/

/*
  시계를 한 칸 진행하고, 이번 칸이 상승인지 하강인지 알려 줍니다.
  판정은 카운트를 올리기 전의 위상으로 합니다.
  주기 8이면 위상 0이 상승, 위상 4가 하강입니다.
  주기 2이면 위상 0이 상승, 위상 1이 하강입니다.
*/
export function stepDivider(divider: Divider): DividerEdge {
  const phase = divider.count % divider.period
  const rising = phase === 0
  const falling = divider.period % 2 === 0 && phase === divider.period / 2
  return {
    divider: { period: divider.period, count: divider.count + 1 },
    rising,
    falling,
  }
}

/*
슈도코드
stepDivider(시계):
  위상 = 센칸을 주기로 나눈 나머지
  상승 = 위상이 0
  하강 = 주기가 짝수이고 위상이 주기의 절반
  센칸을 1 올린 시계와 함께 상승, 하강을 반환
*/
