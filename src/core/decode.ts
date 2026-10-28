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

export function decodeAddr(addr: number, geometry: Geometry): AddrParts {
  const colMask = (1 << geometry.colBits) - 1
  const rowMask = (1 << geometry.rowBits) - 1
  const bankMask = (1 << geometry.bankBits) - 1
  const col = addr & colMask
  const row = (addr >>> geometry.colBits) & rowMask
  const bank = (addr >>> (geometry.colBits + geometry.rowBits)) & bankMask
  return { bank, row, col }
}

export function encodeAddr(parts: AddrParts, geometry: Geometry): number {
  return (
    (parts.col & ((1 << geometry.colBits) - 1)) |
    ((parts.row & ((1 << geometry.rowBits) - 1)) << geometry.colBits) |
    ((parts.bank & ((1 << geometry.bankBits) - 1)) << (geometry.colBits + geometry.rowBits))
  )
}
