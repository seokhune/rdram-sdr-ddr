export const BANK_COLORS = [
  '#6ea8fe',
  '#e0924a',
  '#3cba78',
  '#c58be0',
  '#e2c15a',
  '#4ec4d4',
  '#e26b7a',
  '#a3b15a',
  '#8b84e8',
  '#d49255',
  '#5aa6e0',
  '#d46a9e',
  '#6fbf6a',
  '#c9a15a',
  '#5a9a94',
  '#c07a6a',
]

export const STATE_COLOR: Record<string, string> = {
  idle: '#2a3038',
  rowActivating: '#e0924a',
  active: '#2f9d62',
  precharging: '#7d5cc4',
}

export function bankColor(bank: number): string {
  return BANK_COLORS[bank] ?? BANK_COLORS[0]
}

/*
  틱을 나노초 문자열로 바꿉니다. 저장값은 틱이고, 이 함수는 보여줄 때만 씁니다.
  1틱은 1.25ns라서 틱 × 5 / 4입니다. 소수 두 자리는 00, 25, 50, 75 중 하나입니다.
*/
export function nsLabel(tick: number): string {
  const whole = Math.trunc((tick * 5) / 4)
  const frac = Math.abs(tick * 5) % 4
  const digits = ['00', '25', '50', '75'][frac] ?? '00'
  return `${whole}.${digits} ns`
}

/*
슈도코드
nsLabel(틱):
  정수부 = 버림(틱 × 5 / 4)
  소수 = (틱 × 5)을 4로 나눈 나머지. 0, 1, 2, 3이 00, 25, 50, 75
  반환 "정수부.소수 ns"
*/

export function percentile(values: readonly number[], percent: number): number | null {
  if (values.length === 0) return null
  const sorted = values.slice().sort((left, right) => left - right)
  const rank = Math.ceil((percent / 100) * sorted.length) - 1
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))] ?? null
}

/*
  이미 열린 책장에서 권수 b만 읽을 때의 틱입니다. 틱 루프 없이 닫힌 식입니다.
  화면의 점도 이 식을 그대로 계산합니다. 시뮬레이터와 어긋나면 점과 곡선이 갈라집니다.
  b=8이면 SDR 80, DDR 44, RDRAM 63입니다.
  b=4이면 SDR 48, DDR 28, RDRAM 47이라, 여기서 RDRAM이 SDR보다 한 틱 짧아집니다.
  DDR은 b=1부터 8까지 항상 가장 짧습니다.
  RDRAM의 32는 열 표찰과 열 파이프가 들어간 고정분이고, 묶음은 8비트 자리를 16비트 문으로 나눈 올림입니다.
*/
export function closedTicks(arch: string, burst: number): number {
  if (arch === 'sdr') return 24 + (burst - 1) * 8
  if (arch === 'ddr') return 16 + (burst - 1) * 4
  const chunks = Math.ceil((8 * burst) / 16)
  return 32 + chunks * 8 - 1
}

/*
슈도코드
closedTicks(방식, 권수):
  SDR이면 24 + (권수-1)×8
  DDR이면 16 + (권수-1)×4
  RDRAM이면
    묶음 = 올림(8×권수 / 16)
    반환 32 + 묶음×8 - 1
*/
