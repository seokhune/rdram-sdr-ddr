export type OutTable<T> = {
  byId: Map<number, T>
  max: number
}

export function makeOutstanding<T>(max = 4): OutTable<T> {
  return { byId: new Map(), max }
}

export function tryTrack<T>(table: OutTable<T>, id: number, value: T): boolean {
  if (table.byId.has(id)) return false
  if (table.byId.size >= table.max) return false
  table.byId.set(id, value)
  return true
}

export function dropTrack<T>(table: OutTable<T>, id: number): T | undefined {
  const value = table.byId.get(id)
  table.byId.delete(id)
  return value
}
