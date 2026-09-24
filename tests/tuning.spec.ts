import { expect, test } from 'bun:test'
import type { LedgerEntry, TunableConfig } from '../hooks/ledger.ts'
import { applied, currentTuning, describeTuning, dueToPropose, effective, initTuning, proposals, setTuning, tuningOf } from '../hooks/tuning.ts'

const settings: TunableConfig = { timeoutMs: 1500, minDowngradeConfidence: 0.6, effortCloseMargin: 0.15, minHighConfidence: 0.5 }

function turn(at: number, started: string, over: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    at, answered: true, ms: 500, tier: 'balanced', tierConfidence: 0.9, effortLevel: 1, effortConfidence: 0.9,
    startedFrom: 'medium', started, raisedTo: null, toolCalls: 6, failures: 0, strategy: null, strategyConfidence: null,
    advised: false, outcome: 'answer', durationMs: 1000, outputTokens: 500, ...over,
  }
}

/** Easy turns started at high: 20 of them, 15 finished in 2 tool calls or fewer. */
const easyHigh = (from: number) =>
  Array.from({ length: 20 }, (_, i) => turn(from + i, 'high', i < 15 ? { toolCalls: 1 } : {}))

test('a learned change goes into force at once, on top of the settings, and reset goes back', () => {
  let inForce: TunableConfig | null = null
  initTuning(settings, (tuned) => (inForce = tuned))
  setTuning({ values: { minHighConfidence: 0.6 }, since: 10 })
  expect(effective().minHighConfidence).toBe(0.6)
  expect(inForce!.minHighConfidence).toBe(0.6)
  expect(inForce!.minDowngradeConfidence).toBe(0.6)
  setTuning({ values: {}, since: 20 })
  expect(inForce!.minHighConfidence).toBe(0.5)
})

test('high starts that keep turning out easy: high takes a surer answer', () => {
  initTuning(settings, () => undefined)
  setTuning({ values: {}, since: 0 })
  const found = proposals(easyHigh(1))
  expect(found.map((f) => [f.option, f.from, f.to])).toEqual([['minHighConfidence', 0.5, 0.6]])
})

test('it proposes every 20 new turns, not on every turn, and only with evidence', () => {
  initTuning(settings, () => undefined)
  setTuning({ values: {}, since: 0 })
  const entries = easyHigh(1)
  expect(dueToPropose(entries.slice(0, 19))).toEqual([])
  expect(dueToPropose(entries).length).toBe(1)
  expect(dueToPropose([...entries, turn(100, 'high')])).toEqual([])
  expect(dueToPropose(Array.from({ length: 20 }, (_, i) => turn(i + 1, 'medium')))).toEqual([])
})

test('after a change, only turns since then count: the same evidence never pushes twice', () => {
  initTuning(settings, () => undefined)
  setTuning({ values: {}, since: 0 })
  const entries = easyHigh(1)
  const next = applied(currentTuning(), proposals(entries), 1000)
  setTuning(next)
  expect(effective().minHighConfidence).toBe(0.6)
  expect(proposals(entries)).toEqual([])
  expect(proposals([...entries, ...easyHigh(2000)]).map((f) => f.to)).toEqual([0.7])
})

test('whatever the store holds, tuning stays in range and drops what it does not know', () => {
  expect(tuningOf({ values: { minHighConfidence: 7, timeoutMs: 10, effortCloseMargin: -1, bogus: 3 }, since: 5 })).toEqual({
    values: { minHighConfidence: 0.95, timeoutMs: 300, effortCloseMargin: 0 },
    since: 5,
  })
  expect(tuningOf('junk')).toEqual({ values: {}, since: 0 })
  expect(tuningOf({ values: { timeoutMs: Number.NaN } })).toEqual({ values: {}, since: 0 })
})

test('/jev tune says what is tuned against the settings, and what it would change', () => {
  initTuning(settings, () => undefined)
  setTuning({ values: { minHighConfidence: 0.6 }, since: 0 })
  const text = describeTuning(easyHigh(1))
  expect(text).toContain('minHighConfidence        0.6   (settings: 0.5)')
  expect(text).toContain('minHighConfidence: 0.6 → 0.7')
  expect(text).toContain('/jev tune apply')
  setTuning({ values: {}, since: 0 })
  expect(describeTuning([])).toContain('No suggestion yet: 0 of the 20')
})
