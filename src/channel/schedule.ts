import { isRowHit, type Bank } from '../core/bank.ts'

export type SchedJob = {
  id: number
  bank: number
  row: number
}

export type SchedChoice<T extends SchedJob> = {
  job: T
  act: 'read' | 'activate' | 'precharge'
}

export function pickOpenPage<T extends SchedJob>(
  jobs: readonly T[],
  banks: readonly Bank[],
  canOpen: (job: T) => boolean = () => true,
): SchedChoice<T> | undefined {
  for (const job of jobs) {
    if (isRowHit(banks[job.bank], job.row)) return { job, act: 'read' }
  }
  for (const job of jobs) {
    if (banks[job.bank].state === 'idle' && canOpen(job)) return { job, act: 'activate' }
  }
  for (const job of jobs) {
    const bank = banks[job.bank]
    if (bank.state === 'active' && bank.openRow !== job.row) return { job, act: 'precharge' }
  }
  return undefined
}
