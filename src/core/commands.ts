/*
  SDR과 DDR의 핀 네 개입니다. ISSI IS43R16800CC 진리표를 따릅니다.
  CS, RAS, CAS, WE가 0 또는 1입니다. 칩을 고르면 CS는 0입니다.
  RDRAM은 이 표를 쓰지 않고, 복도에 ROW 또는 COL 표찰을 붙입니다.
*/

import type { Bit } from '../gates/logic.ts'

export type CommandName =
  | 'ACTIVATE'
  | 'READ'
  | 'WRITE'
  | 'PRECHARGE'
  | 'REFRESH'
  | 'MRS'

export type CommandPins = {
  cs: Bit
  ras: Bit
  cas: Bit
  we: Bit
}

/*
  ACTIVATE  책장 열기.     CS 0, RAS 0, CAS 1, WE 1
  READ       열에서 집기.  CS 0, RAS 1, CAS 0, WE 1
  WRITE      열에 쓰기.    CS 0, RAS 1, CAS 0, WE 0
  PRECHARGE  카트 비우기.  CS 0, RAS 0, CAS 1, WE 0
  REFRESH    다시 쓰기.    CS 0, RAS 0, CAS 0, WE 1
  MRS        모드 설정.    CS 0, RAS 0, CAS 0, WE 0
*/
export const COMMAND_TABLE: Record<CommandName, CommandPins> = {
  ACTIVATE: { cs: 0, ras: 0, cas: 1, we: 1 },
  READ: { cs: 0, ras: 1, cas: 0, we: 1 },
  WRITE: { cs: 0, ras: 1, cas: 0, we: 0 },
  PRECHARGE: { cs: 0, ras: 0, cas: 1, we: 0 },
  REFRESH: { cs: 0, ras: 0, cas: 0, we: 1 },
  MRS: { cs: 0, ras: 0, cas: 0, we: 0 },
}

/* 핀 네 개가 모두 같으면 같은 명령입니다. */
function samePins(a: CommandPins, b: CommandPins): boolean {
  return a.cs === b.cs && a.ras === b.ras && a.cas === b.cas && a.we === b.we
}

/*
슈도코드
samePins(가, 나):
  CS, RAS, CAS, WE가 모두 같으면 참
*/

/* 핀 조합을 명령 이름으로 바꿉니다. 표에 없으면 undefined입니다. */
export function decodeCommand(pins: CommandPins): CommandName | undefined {
  const names = Object.keys(COMMAND_TABLE) as CommandName[]
  return names.find((name) => samePins(COMMAND_TABLE[name], pins))
}

/*
슈도코드
decodeCommand(핀):
  표의 각 명령에 대해
    핀이 그 명령과 같으면 그 이름을 반환
  맞는 명령이 없으면 없음
*/
