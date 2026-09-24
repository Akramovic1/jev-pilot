/** A price in cents, as the shop shows it: "12.50 EUR". */
export function formatPrice(cents: number, currency = 'EUR'): string {
  return `${(cents / 100).toFixed(2)} ${currency}`
}
