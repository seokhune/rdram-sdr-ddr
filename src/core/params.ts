/*
  세 방식의 숫자표입니다.
  1틱은 1.25ns입니다. 코드는 나노초를 더하지 않고 틱만 저장합니다.
  행을 올리는 시간은 Cuppu 표의 성분입니다. 부품 설명서의 tRCD와 같은 칸이 아닙니다.
  SDR과 DDR의 시계는 8틱(10ns, 100MHz). RDRAM의 시계는 2틱(2.5ns, 400MHz).
*/

export type CoreParams = {
  readonly banks: number
  readonly tRp: number
  readonly rowAccess: number
  readonly colAccess: number
  readonly clock: number
}

/* 카트를 비우는 시간. 세 방식 모두 16틱, 20ns. */
export const CUPPU_T_RP = {
  sdr: 16,
  ddr: 16,
  rdram: 16,
} as const

/* 책장 한 줄을 카트에 올리는 시간. SDR 24틱(30ns), DDR 16틱(20ns), RDRAM 14틱(17.5ns). */
export const CUPPU_ROW_ACCESS = {
  sdr: 24,
  ddr: 16,
  rdram: 14,
} as const

/* 카트에서 몇 번째 책인지 고르는 시간. SDR 24, DDR 16, RDRAM 24틱. */
export const CUPPU_COL_ACCESS = {
  sdr: 24,
  ddr: 16,
  rdram: 24,
} as const

/* 코어가 한 걸음 걷는 간격. SDR 8, DDR 8, RDRAM 2틱. 매 틱마다 걸으면 속도가 부풉니다. */
export const CUPPU_CLOCK = {
  sdr: 8,
  ddr: 8,
  rdram: 2,
} as const

/*
  책 한 권이 문을 차지하는 틱.
  SDR은 권마다 8틱입니다. DDR 상수도 8로 적혀 있지만, 상승과 하강에서 한 권씩 꺼내므로
  닫힌 식의 추가 권은 4틱입니다. RDRAM 표찰과 내부 묶음도 8틱 한 덩어리입니다.
*/
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

/* RDRAM 방 16개가 나누는 카트 자리. 방 n은 자리 n과 n+1을 같이 씁니다. */
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

/*
  리프레시 한 번이 잠그는 길이입니다. 간격과는 다른 숫자입니다.
  비우기 시간에 행을 올리는 시간을 더합니다. 부품 설명서의 tRFC를 따로 베끼지 않습니다.
  SDR 16+24=40, DDR 16+16=32, RDRAM 16+14=30틱.
*/
export function refreshBusyTicks(arch: 'sdr' | 'ddr' | 'rdram'): number {
  if (arch === 'sdr') return CUPPU_T_RP.sdr + CUPPU_ROW_ACCESS.sdr
  if (arch === 'ddr') return CUPPU_T_RP.ddr + CUPPU_ROW_ACCESS.ddr
  return CUPPU_T_RP.rdram + CUPPU_ROW_ACCESS.rdram
}

/*
슈도코드
refreshBusyTicks(방식):
  SDR이면 비우기 16 + 행 24
  DDR이면 비우기 16 + 행 16
  RDRAM이면 비우기 16 + 행 14
*/

/*
  전역 틱을 장치 걸음으로 바꿉니다.
  틱이 그 장치의 시계로 나누어떨어지지 않으면 거절합니다. 소수 걸음은 없습니다.
  행 24틱을 SDR 시계 8로 나누면 3걸음입니다. 열 24틱을 RDRAM 시계 2로 나누면 12걸음입니다.
*/
export function deviceSteps(globalTicks: number, clock: number): number {
  if (globalTicks % clock !== 0) {
    throw new Error(`${globalTicks} ticks is not a whole number of clocks of ${clock}`)
  }
  return globalTicks / clock
}

/*
슈도코드
deviceSteps(전역틱, 시계):
  전역틱을 시계로 나눈 나머지가 0이 아니면 오류
  반환 전역틱 ÷ 시계
*/
