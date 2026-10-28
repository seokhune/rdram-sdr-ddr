export type CoreParams = {
  readonly banks: number
  readonly tRp: number
  readonly rowAccess: number
  readonly colAccess: number
  readonly clock: number
}

export const CUPPU_T_RP = {
  sdr: 16,
  ddr: 16,
  rdram: 16,
} as const

export const CUPPU_ROW_ACCESS = {
  sdr: 24,
  ddr: 16,
  rdram: 14,
} as const

export const CUPPU_COL_ACCESS = {
  sdr: 24,
  ddr: 16,
  rdram: 24,
} as const

export const CUPPU_CLOCK = {
  sdr: 8,
  ddr: 8,
  rdram: 2,
} as const

export const SDR_TRANSFER_TICKS_PER_WORD = 8
export const DDR_TRANSFER_TICKS_PER_WORD = 8
export const RDRAM_INTERNAL_CHUNK_TICKS = 8
export const OCTCYCLE_TICKS = 8

export const CUPPU_SDR: CoreParams = {
  banks: 4,
  tRp: CUPPU_T_RP.sdr,
  rowAccess: CUPPU_ROW_ACCESS.sdr,
  colAccess: CUPPU_COL_ACCESS.sdr,
  clock: CUPPU_CLOCK.sdr,
}

export const CUPPU_DDR: CoreParams = {
  banks: 4,
  tRp: CUPPU_T_RP.ddr,
  rowAccess: CUPPU_ROW_ACCESS.ddr,
  colAccess: CUPPU_COL_ACCESS.ddr,
  clock: CUPPU_CLOCK.ddr,
}

export const CUPPU_RDRAM: CoreParams = {
  banks: 16,
  tRp: CUPPU_T_RP.rdram,
  rowAccess: CUPPU_ROW_ACCESS.rdram,
  colAccess: CUPPU_COL_ACCESS.rdram,
  clock: CUPPU_CLOCK.rdram,
}

export const HALF_ROW_SLOTS = 17

// TODO: refresh is not stepped in this version. The period is not one shared
// number. Commodity DRAM refreshes every bank together on a 64 ms period.
// Rambus uses 33 ms, refreshes one internal bank at a time, and spreads the
// banks across N slices, so the worst wait is one row refresh.
export const REFRESH_PERIOD_MS = {
  commodityDram: 64,
  rambus: 33,
} as const

export function deviceSteps(globalTicks: number, clock: number): number {
  if (globalTicks % clock !== 0) {
    throw new Error(`${globalTicks} ticks is not a whole number of clocks of ${clock}`)
  }
  return globalTicks / clock
}
