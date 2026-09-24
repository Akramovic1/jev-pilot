/**
 * A duration as people write it, in milliseconds:
 *   "90s" → 90000, "1h30m" → 5400000, "1h 30m" → 5400000, "250ms" → 250, "2d" → 172800000
 * Units: d, h, m, s, ms. Parts may be separated by spaces and must go from
 * the largest unit to the smallest, each unit at most once. A bare number
 * is seconds ("45" → 45000). Anything else (empty, unknown units, units out
 * of order, negative or fractional numbers) throws a RangeError.
 */
export function parseDuration(text: string): number {
  throw new Error('not implemented')
}
