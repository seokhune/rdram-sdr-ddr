/*
  도서관 본체입니다. 세 문(SDR, DDR, RDRAM)이 이 한 벌을 같이 씁니다.
  방은 배열이고, 방마다 타이머가 따로 돕니다. 줄 하나로 모든 방을 세우지 않습니다.
*/

import { idleBank, stepBank, type Bank } from './bank.ts'

export type DramCore = {
  banks: Bank[]
}

/* 방 bankCount개를 모두 쉼으로 만듭니다. SDR과 DDR은 4, RDRAM은 16입니다. */
export function makeCore(bankCount: number): DramCore {
  return { banks: Array.from({ length: bankCount }, () => idleBank()) }
}

/*
슈도코드
makeCore(방개수):
  방개수만큼 빈 방을 나란히 만들어 반환
*/

/* 장치 시계가 올라갈 때 모든 방의 타이머를 한 걸음씩 줄입니다. */
export function stepCore(core: DramCore): DramCore {
  return { banks: core.banks.map((bank) => stepBank(bank)) }
}

/*
슈도코드
stepCore(코어):
  각 방에 stepBank를 적용한 새 코어를 반환
*/

/* 방 하나만 갈아 끼웁니다. 다른 방의 상태는 그대로입니다. */
export function replaceBank(core: DramCore, index: number, bank: Bank): DramCore {
  const banks = core.banks.slice()
  banks[index] = bank
  return { banks }
}

/*
슈도코드
replaceBank(코어, 번호, 새방):
  방 배열을 복사한다
  그 번호의 방을 새방으로 바꾼다
  반환
*/
