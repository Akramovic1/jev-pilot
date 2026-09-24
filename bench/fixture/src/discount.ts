import { total, type Line } from './cart.ts'

export interface Code {
  code: string
  /** A percentage off the cart, e.g. 10 for 10%. */
  percent?: number
  /** A fixed amount off, in cents. */
  cents?: number
  /** The cart total (before any discount) this code needs, in cents. */
  minCents?: number
}

/**
 * The cart total after discount codes, in cents. The shop's rules:
 * - A code with `minCents` applies only if the cart total before any
 *   discount is at least `minCents`.
 * - Of the codes that apply, at most one percent code and one fixed code
 *   are used: of each kind, the one that saves the most.
 * - The percent code applies first, to the whole cart total, rounded to the
 *   nearest cent (half a cent rounds up).
 * - Then the fixed code. The total never goes below zero.
 */
export function discounted(lines: Line[], codes: Code[]): number {
  const percent = codes.find((code) => code.percent !== undefined)
  const fixed = codes.find((code) => code.cents !== undefined)
  let sum = 0
  for (const line of lines) {
    const cost = line.cents * line.qty
    sum += percent ? Math.floor(cost * (1 - percent.percent! / 100)) : cost
  }
  if (fixed && (fixed.minCents === undefined || sum >= fixed.minCents)) sum -= fixed.cents!
  return sum
}

export { total }
