import { expect, test } from 'bun:test'
import { discounted } from '../src/discount.ts'

const lines = [
  { name: 'Mug', cents: 1255, qty: 1 },
  { name: 'Tea', cents: 333, qty: 3 },
]
// Cart total: 1255 + 999 = 2254 cents.

test('no codes: the cart total', () => expect(discounted(lines, [])).toBe(2254))
test('a percent code applies to the whole total, rounded to the nearest cent', () => {
  // 2254 * 0.85 = 1915.9 → 1916
  expect(discounted(lines, [{ code: 'P15', percent: 15 }])).toBe(1916)
})
test('half a cent rounds up', () => {
  // 1255 * 0.9 = 1129.5 → 1130
  expect(discounted([{ name: 'Mug', cents: 1255, qty: 1 }], [{ code: 'P10', percent: 10 }])).toBe(1130)
})
test('of several codes of a kind, the one that saves the most wins', () => {
  expect(discounted(lines, [{ code: 'P5', percent: 5 }, { code: 'P20', percent: 20 }])).toBe(1803)
  expect(discounted(lines, [{ code: 'F1', cents: 100 }, { code: 'F5', cents: 500 }])).toBe(1754)
})
test('percent first, then the fixed amount', () => {
  // 2254 → 1803 (20%) → 1303
  expect(discounted(lines, [{ code: 'F5', cents: 500 }, { code: 'P20', percent: 20 }])).toBe(1303)
})
test('minCents is checked against the total before any discount', () => {
  // The cart is 2254 before discounts: the fixed code's 2000 minimum is met,
  // even though 50% off leaves 1127.
  expect(discounted(lines, [{ code: 'P50', percent: 50 }, { code: 'F3', cents: 300, minCents: 2000 }])).toBe(827)
  expect(discounted(lines, [{ code: 'P50', percent: 50, minCents: 5000 }])).toBe(2254)
})
test('never below zero', () => expect(discounted(lines, [{ code: 'F99', cents: 9999 }])).toBe(0))
