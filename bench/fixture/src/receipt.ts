import { formatPrice } from './format.ts'

/** A one-line receipt; the shop's currency when none is given. */
export function receipt(paidCents: number, currency?: string): string {
  return `Paid ${currency ? formatPrice(paidCents, currency) : formatPrice(paidCents)}`
}
