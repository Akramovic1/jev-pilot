import { total, type Line } from './cart.ts'
import { formatPrice } from './format.ts'

export function invoice(customer: string, lines: Line[]): string {
  return [`Invoice for ${customer}`, ...lines.map((l) => `- ${l.name}`), `Total: ${formatPrice(total(lines))}`].join('\n')
}
