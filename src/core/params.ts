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

// Commodity DRAM (ISSI IS43R16800CC) retains a row for 64 ms and splits that
// window into 4096 refresh commands. 64 ms / 4096 = 15.625 us = 12,500 ticks.
// Cuppu-Jacob §5.1: a ganged commodity refresh stalls every bank at once, and
// that stall has been reported at up to half of observed latency.
// Rambus (Cuppu-Jacob 1999 §5.1) uses a 33 ms period and refreshes internal
// banks one at a time, so the worst wait is one row refresh.
export const REFRESH_PERIOD_MS = {
  commodityDram: 64,
  rambus: 33,
} as const

export const REFRESH_CYCLES_PER_PERIOD = {
  commodityDram: 4096,
  // TODO(Davis thesis or a Rambus datasheet): the Rambus internal cycle count
  // is not stated in Cuppu-Jacob. 4096 is an assumption, not a confirmed value.
  rambus: 4096,
} as const

export const COMMODITY_REFRESH_INTERVAL_TICKS = 12_500

// 33 ms is 26,400,000 ticks. 26,400,000 / 4096 = 6,445.3125. The refresh
// specification fixes the rounded interval at 6,446 ticks.
export const RAMBUS_REFRESH_INTERVAL_TICKS = 6_446

export function refreshBusyTicks(arch: 'sdr' | 'ddr' | 'rdram'): number {
  if (arch === 'sdr') return CUPPU_T_RP.sdr + CUPPU_ROW_ACCESS.sdr
  if (arch === 'ddr') return CUPPU_T_RP.ddr + CUPPU_ROW_ACCESS.ddr
  return CUPPU_T_RP.rdram + CUPPU_ROW_ACCESS.rdram
}

export function deviceSteps(globalTicks: number, clock: number): number {
  if (globalTicks % clock !== 0) {
    throw new Error(`${globalTicks} ticks is not a whole number of clocks of ${clock}`)
  }
  return globalTicks / clock
}
