export type Bit = 0 | 1

export function and(a: Bit, b: Bit): Bit {
  return a === 1 && b === 1 ? 1 : 0
}

export function or(a: Bit, b: Bit): Bit {
  return a === 1 || b === 1 ? 1 : 0
}

export function not(a: Bit): Bit {
  return a === 1 ? 0 : 1
}

export function mux<T>(sel: Bit, when0: T, when1: T): T {
  return sel === 0 ? when0 : when1
}
