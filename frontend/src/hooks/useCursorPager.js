import { useCallback, useMemo, useState } from 'react'

export function useCursorPager() {
  const [cursor, setCursor] = useState('')
  const [cursorStack, setCursorStack] = useState([])
  const [nextCursor, setNextCursor] = useState(null)
  const [hasMore, setHasMore] = useState(false)

  const hasPrev = cursorStack.length > 0
  const page = cursorStack.length + 1

  const sync = useCallback((response) => {
    setNextCursor(response?.nextCursor || null)
    setHasMore(Boolean(response?.hasMore))
  }, [])

  const reset = useCallback(() => {
    setCursor('')
    setCursorStack([])
    setNextCursor(null)
    setHasMore(false)
  }, [])

  const goNext = useCallback(() => {
    if (!nextCursor) {
      return
    }

    setCursorStack((current) => [...current, cursor])
    setCursor(nextCursor)
    setNextCursor(null)
    setHasMore(false)
  }, [cursor, nextCursor])

  const goPrev = useCallback(() => {
    if (!cursorStack.length) {
      return
    }

    const previousCursor = cursorStack[cursorStack.length - 1]
    setCursorStack((current) => current.slice(0, -1))
    setCursor(previousCursor)
    setNextCursor(null)
    setHasMore(false)
  }, [cursorStack])

  return useMemo(() => ({
    cursor,
    hasPrev,
    hasMore,
    nextCursor,
    page,
    reset,
    sync,
    goNext,
    goPrev,
  }), [cursor, goNext, goPrev, hasMore, hasPrev, nextCursor, page, reset, sync])
}
