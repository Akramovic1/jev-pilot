import { expect, test } from 'bun:test'
import { parseDuration } from '../src/duration.ts'

test('single units', () => {
  expect(parseDuration('90s')).toBe(90_000)
  expect(parseDuration('250ms')).toBe(250)
  expect(parseDuration('2d')).toBe(172_800_000)
})
test('several units, with or without spaces', () => {
  expect(parseDuration('1h30m')).toBe(5_400_000)
  expect(parseDuration('1h 30m')).toBe(5_400_000)
  expect(parseDuration('1m 5s 20ms')).toBe(65_020)
})
test('a bare number is seconds', () => expect(parseDuration('45')).toBe(45_000))
test('nonsense throws a RangeError', () => {
  for (const bad of ['', 'abc', '5x', '30m1h', '1h1h', '-5s', '1.5h', 'h']) expect(() => parseDuration(bad)).toThrow(RangeError)
})
