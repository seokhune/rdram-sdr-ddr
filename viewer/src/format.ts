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

export function nsLabel(tick: number): string {
  const whole = Math.trunc((tick * 5) / 4)
  const frac = Math.abs(tick * 5) % 4
  const digits = ['00', '25', '50', '75'][frac] ?? '00'
  return `${whole}.${digits} ns`
}

export function percentile(values: readonly number[], percent: number): number | null {
  if (values.length === 0) return null
  const sorted = values.slice().sort((left, right) => left - right)
  const rank = Math.ceil((percent / 100) * sorted.length) - 1
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))] ?? null
}

export function closedTicks(arch: string, burst: number): number {
  if (arch === 'sdr') return 24 + (burst - 1) * 8
  if (arch === 'ddr') return 16 + (burst - 1) * 4
  const chunks = Math.ceil((8 * burst) / 16)
  return 32 + chunks * 8 - 1
}
