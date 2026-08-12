export function buildPaginationMeta({ offset = 0, limit = 50, count = 0, total = 0 }) {
  const safeOffset = Math.max(0, Number(offset) || 0)
  const safeLimit = Math.max(1, Number(limit) || 1)
  const safeCount = Math.max(0, Number(count) || 0)
  const safeTotal = Math.max(0, Number(total) || 0)

  return {
    pageStart: safeTotal === 0 ? 0 : safeOffset + 1,
    pageEnd: safeTotal === 0 ? 0 : Math.min(safeOffset + safeCount, safeTotal),
    hasPrev: safeOffset > 0,
    hasNext: safeOffset + safeCount < safeTotal,
    maxOffset: safeTotal > 0 ? Math.floor((safeTotal - 1) / safeLimit) * safeLimit : 0,
  }
}

export function clampOffset(offset, total, limit) {
  const safeOffset = Math.max(0, Number(offset) || 0)
  const safeTotal = Math.max(0, Number(total) || 0)
  const safeLimit = Math.max(1, Number(limit) || 1)

  if (safeTotal === 0) {
    return 0
  }

  const maxOffset = Math.floor((safeTotal - 1) / safeLimit) * safeLimit
  return Math.min(safeOffset, maxOffset)
}
