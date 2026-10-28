/*
  SDR과 DDR이 다음 일을 고르는 순서입니다.
  이미 열린 행의 읽기를 먼저 합니다. 행을 다시 열지 않습니다.
  그 다음 빈 방을 열고, 그것도 없으면 다른 행이 열린 방을 비웁니다.
*/

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

/*
  대기열에서 지금 할 수 있는 일 하나를 고릅니다.
  canOpen이 거짓이면 그 주문은 새 책장을 열 후보에서 빠집니다.
  세 바퀴를 돌아도 없으면 undefined입니다. 그때는 열 줄만 한 칸 밉니다.
*/
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

/*
슈도코드
pickOpenPage(대기열, 방들, 열수있나):
  대기열을 앞에서부터
    그 방이 요청 행을 이미 열었으면
      반환 { 그 주문, 읽기 }
  대기열을 다시
    방이 쉼이고 열 수 있으면
      반환 { 그 주문, 열기 }
  대기열을 다시
    방이 열려 있는데 다른 행이면
      반환 { 그 주문, 비우기 }
  없으면 반환 없음
*/
