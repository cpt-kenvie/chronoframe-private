import type { StorageByteRange } from '~~/server/services/storage/interfaces'

const parseRangeNumber = (value: string): number | null => {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

/**
 * 解析单段 HTTP bytes Range；不支持的多段或非法范围统一返回 null。
 */
export const parseByteRange = (
  rangeHeader: string,
  size: number,
): StorageByteRange | null => {
  if (!Number.isSafeInteger(size) || size <= 0) return null

  const matches = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader)
  if (!matches || (!matches[1] && !matches[2])) return null

  if (!matches[1]) {
    const suffixLength = parseRangeNumber(matches[2] ?? '')
    if (!suffixLength) return null
    return {
      start: Math.max(0, size - suffixLength),
      end: size - 1,
    }
  }

  const start = parseRangeNumber(matches[1])
  if (start === null || start >= size) return null

  const requestedEnd = matches[2]
    ? parseRangeNumber(matches[2])
    : size - 1
  if (requestedEnd === null || start > requestedEnd) return null

  return {
    start,
    end: Math.min(requestedEnd, size - 1),
  }
}
