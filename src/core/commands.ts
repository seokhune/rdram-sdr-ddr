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

export const COMMAND_TABLE: Record<CommandName, CommandPins> = {
  ACTIVATE: { cs: 0, ras: 0, cas: 1, we: 1 },
  READ: { cs: 0, ras: 1, cas: 0, we: 1 },
  WRITE: { cs: 0, ras: 1, cas: 0, we: 0 },
  PRECHARGE: { cs: 0, ras: 0, cas: 1, we: 0 },
  REFRESH: { cs: 0, ras: 0, cas: 0, we: 1 },
  MRS: { cs: 0, ras: 0, cas: 0, we: 0 },
}

function samePins(a: CommandPins, b: CommandPins): boolean {
  return a.cs === b.cs && a.ras === b.ras && a.cas === b.cas && a.we === b.we
}

export function decodeCommand(pins: CommandPins): CommandName | undefined {
  const names = Object.keys(COMMAND_TABLE) as CommandName[]
  return names.find((name) => samePins(COMMAND_TABLE[name], pins))
}
