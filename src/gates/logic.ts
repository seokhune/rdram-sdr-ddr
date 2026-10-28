/*
  핀 한 비트의 논리입니다.
  상태를 기억하지 않는 순수 함수입니다. 0과 1만 다룹니다.
*/

export type Bit = 0 | 1

/* 둘 다 1일 때만 1. */
export function and(a: Bit, b: Bit): Bit {
  return a === 1 && b === 1 ? 1 : 0
}

/*
슈도코드
and(a, b):
  a와 b가 모두 1이면 1, 아니면 0
*/

/* 하나라도 1이면 1. */
export function or(a: Bit, b: Bit): Bit {
  return a === 1 || b === 1 ? 1 : 0
}

/*
슈도코드
or(a, b):
  a 또는 b가 1이면 1, 아니면 0
*/

/* 1이면 0, 0이면 1. */
export function not(a: Bit): Bit {
  return a === 1 ? 0 : 1
}

/*
슈도코드
not(a):
  a가 1이면 0, 아니면 1
*/

/* 선택 비트가 0이면 when0, 1이면 when1. */
export function mux<T>(sel: Bit, when0: T, when1: T): T {
  return sel === 0 ? when0 : when1
}

/*
슈도코드
mux(선택, 값0, 값1):
  선택이 0이면 값0, 아니면 값1
*/
