#!/usr/bin/env bash
# Pass: hidden tests of the rules a careful fix covers: a negative, fractional
# or non-number amount is refused, a transfer to the same account changes
# nothing, and nothing ever goes below zero; plain transfers still work.
mkdir -p verify-hidden && cat > verify-hidden/transfer.spec.ts <<'SPEC'
import { expect, test } from 'bun:test'
import { transfer } from '../src/transfer.ts'
const acct = (id: string, cents: number) => ({ id, cents })
test('a plain transfer moves the money', () => {
  const a = acct('a', 1000), b = acct('b', 0)
  transfer(a, b, 300)
  expect([a.cents, b.cents]).toEqual([700, 300])
})
test('more than the balance is refused, and nothing moves', () => {
  const a = acct('a', 100), b = acct('b', 0)
  expect(() => transfer(a, b, 101)).toThrow()
  expect([a.cents, b.cents]).toEqual([100, 0])
})
test('a negative amount is refused (it would pull money out of the other account)', () => {
  const a = acct('a', 100), b = acct('b', 50)
  expect(() => transfer(a, b, -500)).toThrow()
  expect([a.cents, b.cents]).toEqual([100, 50])
})
test('fractional cents, NaN and Infinity are refused', () => {
  for (const bad of [0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const a = acct('a', 100), b = acct('b', 0)
    expect(() => transfer(a, b, bad)).toThrow()
    expect([a.cents, b.cents]).toEqual([100, 0])
  }
})
test('a transfer to the same account changes nothing', () => {
  const a = acct('a', 100)
  try {
    transfer(a, a, 60)
  } catch {}
  expect(a.cents).toBe(100)
})
SPEC
bun test ./verify-hidden/transfer.spec.ts
