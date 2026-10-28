import { idleBank, stepBank, type Bank } from './bank.ts'

export type DramCore = {
  banks: Bank[]
}

export function makeCore(bankCount: number): DramCore {
  return { banks: Array.from({ length: bankCount }, () => idleBank()) }
}

export function stepCore(core: DramCore): DramCore {
  return { banks: core.banks.map((bank) => stepBank(bank)) }
}

export function replaceBank(core: DramCore, index: number, bank: Bank): DramCore {
  const banks = core.banks.slice()
  banks[index] = bank
  return { banks }
}
