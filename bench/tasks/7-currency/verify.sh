#!/usr/bin/env bash
# Pass: a hidden test of the new argument passes, and the existing tests still do.
mkdir -p verify-hidden && cat > verify-hidden/currency.spec.ts <<'SPEC'
import { expect, test } from 'bun:test'
import { invoice } from '../src/invoice.ts'
const lines = [{ name: 'Mug', cents: 1250, qty: 2 }, { name: 'Tea', cents: 499, qty: 1 }]
test('the invoice shows the total in the currency given', () => expect(invoice('Ada', lines, 'USD')).toContain('Total: 29.99 USD'))
test('no currency given: EUR', () => expect(invoice('Ada', lines)).toContain('Total: 29.99 EUR'))
test('no other currency appears', () => expect(invoice('Ada', lines, 'USD')).not.toContain('EUR'))
SPEC
bun test ./verify-hidden/currency.spec.ts tests/cart.spec.ts
