import { useCallback, useEffect, useRef } from 'react'

export function useAutoRefresh(callback, intervalMs = 10000, enabled = true) {
  const callbackRef = useRef(callback)
  const inFlightRef = useRef(false)

  callbackRef.current = callback

  const runRefresh = useCallback(async ({ force = false } = {}) => {
    if (inFlightRef.current) {
      return
    }

    if (!force && typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return
    }

    inFlightRef.current = true

    try {
      await callbackRef.current()
    } finally {
      inFlightRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!enabled || intervalMs <= 0) {
      return undefined
    }

    const intervalId = window.setInterval(() => {
      void runRefresh()
    }, intervalMs)

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        void runRefresh()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [enabled, intervalMs, runRefresh])

  return useCallback(() => {
    void runRefresh({ force: true })
  }, [runRefresh])
}
