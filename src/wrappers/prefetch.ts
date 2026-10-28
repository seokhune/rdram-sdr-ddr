export type Prefetch2 = {
  buf: [number | undefined, number | undefined]
  count: 0 | 1 | 2
}

export function emptyPrefetch(): Prefetch2 {
  return { buf: [undefined, undefined], count: 0 }
}

export function loadPair(
  prefetch: Prefetch2,
  first: number,
  second: number | undefined,
): Prefetch2 {
  const count = second === undefined ? 1 : 2
  return { buf: [first, second], count }
}

export function shiftOut(prefetch: Prefetch2): {
  prefetch: Prefetch2
  id: number | undefined
} {
  if (prefetch.count === 0) return { prefetch, id: undefined }
  const id = prefetch.buf[0]
  const count = (prefetch.count - 1) as 0 | 1
  return { prefetch: { buf: [prefetch.buf[1], undefined], count }, id }
}
