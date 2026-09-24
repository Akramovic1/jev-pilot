import { formatPrice } from './format.ts'

export interface Line { name: string; cents: number; qty: number }

export function total(lines: Line[]): number {
  return lines.reduce((sum, line) => sum + line.cents * line.qty, 0)
}

export function describe(lines: Line[]): string {
  return lines.map((line) => `${line.qty} x ${line.name}: ${formatPrice(line.cents * line.qty)}`).join('\n')
}
