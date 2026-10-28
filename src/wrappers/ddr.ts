/*
  DDR 문입니다. 코어가 걷는 간격은 SDR과 같이 8틱입니다.
  차이는 jedec.ts가 시계가 내려갈 때도 drainDdr로 책을 한 권 더 꺼낸다는 점입니다.
*/

export { enqueue, isSettled, makeDdr, runUntilSettled, stepDdr, stepToRising } from './jedec.ts'
export type { Device as Ddr, ManualCmd, MemJob, Track } from './jedec.ts'
