/*
  주소 한 개를 방, 행, 열로 나눕니다.
  아래 비트가 열, 그 위가 행, 맨 위가 방입니다.
  이 시뮬레이터는 전하 전압을 풀지 않고, 이 세 정수만 방으로 보냅니다.
*/

export type Geometry = {
  colBits: number
  rowBits: number
  bankBits: number
}

export type AddrParts = {
  bank: number
  row: number
  col: number
}

/*
  주소에서 열, 행, 방을 잘라 냅니다.
  마스크는 그 비트 수만큼의 1입니다. 열 3비트면 마스크는 7입니다.
*/
export function decodeAddr(addr: number, geometry: Geometry): AddrParts {
  const colMask = (1 << geometry.colBits) - 1
  const rowMask = (1 << geometry.rowBits) - 1
  const bankMask = (1 << geometry.bankBits) - 1
  const col = addr & colMask
  const row = (addr >>> geometry.colBits) & rowMask
  const bank = (addr >>> (geometry.colBits + geometry.rowBits)) & bankMask
  return { bank, row, col }
}

/*
슈도코드
decodeAddr(주소, 비트구성):
  열 = 주소의 아래 열비트
  행 = 열비트만큼 오른쪽으로 민 뒤의 행비트
  방 = 열비트+행비트만큼 민 뒤의 방비트
  반환 { 방, 행, 열 }
*/

/* decodeAddr의 반대. 방, 행, 열을 다시 주소 하나로 붙입니다. */
export function encodeAddr(parts: AddrParts, geometry: Geometry): number {
  return (
    (parts.col & ((1 << geometry.colBits) - 1)) |
    ((parts.row & ((1 << geometry.rowBits) - 1)) << geometry.colBits) |
    ((parts.bank & ((1 << geometry.bankBits) - 1)) << (geometry.colBits + geometry.rowBits))
  )
}

/*
슈도코드
encodeAddr(조각, 비트구성):
  열을 아래에 둔다
  행을 열비트만큼 왼쪽으로 밀어 붙인다
  방을 열비트+행비트만큼 밀어 붙인다
  반환 주소
*/
