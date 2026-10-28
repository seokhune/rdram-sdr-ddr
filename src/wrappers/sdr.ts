/*
  SDR 문입니다. 실제 한 틱은 jedec.ts의 stepDevice가 걷습니다.
  시계가 올라갈 때만 명령을 받고, 책도 그때만 꺼냅니다.
*/

export {
  enqueue,
  isSettled,
  makeSdr,
  runUntilSettled,
  stepSdr,
  stepToRising,
} from './jedec.ts'
export type { Device as Sdr, ManualCmd, MemJob, Track } from './jedec.ts'
