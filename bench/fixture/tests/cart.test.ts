import { expect, test } from 'bun:test'
import { describe as describeCart, total } from '../src/cart.ts'
import { invoice } from '../src/invoice.ts'
import { receipt } from '../src/receipt.ts'

const lines = [{ name: 'Mug', cents: 1250, qty: 2 }, { name: 'Tea', cents: 499, qty: 1 }]

test('the total is in cents', () => expect(total(lines)).toBe(2999))
test('lines show their price', () => expect(describeCart(lines)).toContain('2 x Mug: 25.00 EUR'))
test('the invoice shows the total', () => expect(invoice('Ada', lines)).toContain('Total: 29.99 EUR'))
test('a receipt names the currency', () => expect(receipt(500, 'USD')).toBe('Paid 5.00 USD'))
