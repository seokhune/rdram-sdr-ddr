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
// Davis states the same 4096 cycles / 64 ms. Cuppu-Jacob §5.1: a ganged
// commodity refresh stalls every bank at once.
//
// Direct RDRAM REFA spacing is tREF / 2^(BBIT+RBIT). Samsung KM416RD8AC
// (128/144 Mbit Direct RDRAM, Rev. 1.01, Oct 1999) Table 19: tREF = 32 ms.
// The RIMM SPD for that die (KMMR16R84, Feb 2000) records 2×16 dependent
// banks, 9 row-address bits, and 16K refreshes / 32 ms, so BBIT+RBIT = 14
// and 2^14 = 16,384. 32 ms is 25,600,000 ticks. 25,600,000 / 16,384 = 1,562.5.
// tREF is a maximum, so the interval is the greatest integer that does not
// exceed that average. The 64 Mbit Rambus sheet (3/12/98) is the same 32 ms
// over 16 banks × 512 rows = 8,192, which is 3,125 ticks. This model follows
// the 128 Mbit part. One event still locks one bank for tRP + row access.
export const REFRESH_PERIOD_MS = {
  commodityDram: 64,
  rambus: 32,
} as const

export const REFRESH_CYCLES_PER_PERIOD = {
  commodityDram: 4096,
  rambus: 16384,
} as const

export const COMMODITY_REFRESH_INTERVAL_TICKS = 12_500

export const RAMBUS_REFRESH_INTERVAL_TICKS = 1_562

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
