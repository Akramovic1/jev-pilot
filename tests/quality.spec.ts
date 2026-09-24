import { expect, test } from 'bun:test'
import { capabilityNote, qualityAdvice, QUALITY_BARS, questions, readDecision, requestBody, SPIN_EDITS, spinOf, stepBackNote } from '../hooks/model-router.policy.ts'
import type { Decision } from '../hooks/model-router.policy.ts'
import { markCorrected, suggestions, summarize } from '../hooks/ledger.ts'
import type { LedgerEntry } from '../hooks/ledger.ts'

const base: Decision = { tier: 'balanced', confidence: 0.9, risky: 0.05, effort: 1, effortConfidence: 0.9 }

// ---- the questions, in the one request ------------------------------------------------

test('the quality questions ride in the main turn\'s request only, as nouls (booleans on the Gateway)', () => {
  const asked = questions('openrouter', true, false, [], false, true) as Record<string, { type: string; criteria?: object }>
  for (const name of ['corrects', 'underspecified', 'sensitive', 'bugfix']) {
    expect(asked[name]?.type).toBe('noul')
    expect(asked[name]?.criteria).toBeDefined()
  }
  expect(Object.keys(questions('openrouter', true))).not.toContain('corrects')
  expect((questions('gateway', false, false, [], false, true) as Record<string, { type: string }>).sensitive?.type).toBe('boolean')
  expect(JSON.parse(requestBody('openrouter', { prompt: 'x' }, 'm', false, false, [], false, {}, true)).questions.bugfix).toBeDefined()
})

test('the answers read into the decision; ones not asked stay out of it', () => {
  const text = JSON.stringify({
    answers: {
      tier: { type: 'choice', choice: 'balanced', probabilities: { balanced: 0.9 }, confidence: 0.9 },
      effort: { type: 'choice', choice: 'medium', probabilities: { medium: 1 }, confidence: 1 },
      corrects: { type: 'noul', noul: 0.95 },
      bugfix: { type: 'noul', noul: 0.9 },
    },
  })
  const decision = readDecision(text)
  expect(decision?.corrects).toBe(0.95)
  expect(decision?.bugfix).toBe(0.9)
  expect(decision && 'sensitive' in decision).toBe(false)
})

// ---- the advice ---------------------------------------------------------------------

test('no read over its bar: no advice at all', () => {
  expect(qualityAdvice({ ...base, underspecified: 0.78, bugfix: 0.44, sensitive: 0.77 }, 'jev-pilot:codex-review')).toBeNull()
  expect(qualityAdvice(null, null)).toBeNull()
})

test('each read over its bar adds its line, with how sure Jev was; the reviewer is named only when there is one', () => {
  const vague = qualityAdvice({ ...base, underspecified: 0.9 }, null) ?? ''
  expect(vague).toContain('<jev_quality>')
  expect(vague).toContain('ask the user one short question, or state in one line the assumption')
  expect(vague).toContain('90% sure')
  const bug = qualityAdvice({ ...base, bugfix: 0.95 }, null) ?? ''
  expect(bug).toContain('a failing test')
  const costly = qualityAdvice({ ...base, sensitive: 0.9 }, 'jev-pilot:codex-review') ?? ''
  expect(costly).toContain('have jev-pilot:codex-review review the change')
  expect(qualityAdvice({ ...base, sensitive: 0.9 }, null)).not.toContain('review the change')
  expect(QUALITY_BARS.underspecified).toBe(0.85)
})

test('the note to the model mentions the quality block only when it is on', () => {
  const off = { effort: true, raise: true, subagents: false, subagentEffort: false, skills: false, strategy: false, model: false }
  expect(capabilityNote(off)).not.toContain('jev_quality')
  expect(capabilityNote({ ...off, quality: true })).toContain('<jev_quality>')
})

// ---- going in circles -------------------------------------------------------------

test('the same file edited four times in a turn is a circle, said once', () => {
  const edits = new Map<string, number>()
  const runs = new Map<string, number>()
  const edit = { tool: 'Edit', file_path: '/repo/src/queue.ts' }
  const said = Array.from({ length: 6 }, () => spinOf(edit, false, edits, runs))
  expect(said.filter(Boolean)).toEqual([`the same file (queue.ts) was edited ${SPIN_EDITS} times in this turn`])
  expect(spinOf({ tool: 'Edit', file_path: '/repo/src/other.ts' }, false, edits, runs)).toBeNull()
})

test('the same command failing three times is a circle; a pass in between starts the count again', () => {
  const edits = new Map<string, number>()
  const runs = new Map<string, number>()
  const run = (failed: boolean, command = 'bun test') => spinOf({ tool: 'Bash', command }, failed, edits, runs)
  // fail, pass, fail: not a circle.
  expect([run(true), run(false), run(true)]).toEqual([null, null, null])
  // ...then two more failures make three in a row, said once.
  expect(run(true, 'bun   test ')).toBeNull()
  expect(run(true)).toContain('failed 3 times')
  expect(run(true)).toBeNull()
  expect(spinOf({ tool: 'Bash', command: 'ls' }, true, new Map(), new Map())).toBeNull()
  expect(stepBackNote('x')).toContain('Step back before the next change')
})

// ---- corrections in the ledger ---------------------------------------------------------

function entry(at: number, started: string, over: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    at, answered: true, ms: 500, tier: 'balanced', tierConfidence: 0.9, effortLevel: 1, effortConfidence: 0.9,
    startedFrom: 'medium', started, raisedTo: null, toolCalls: 3, failures: 0, strategy: null, strategyConfidence: null,
    advised: false, outcome: 'answer', durationMs: 1000, outputTokens: 400, ...over,
  }
}

test('your next message marks exactly the turn before it, by its turn id, never by time', () => {
  // Two sessions finishing turns in the same millisecond: only the one with the id is marked.
  const stored = [entry(1, 'low', { id: 't-a' }), entry(2, 'low', { id: 't-b' }), entry(2, 'medium', { id: 't-c' }), entry(3, 'low')]
  expect(markCorrected(stored, 't-b', true).map((e) => e.corrected)).toEqual([undefined, true, undefined, undefined])
  expect(markCorrected(stored, 'nope', true).every((e) => e.corrected === undefined)).toBe(true)
})

test('the report shows how often each starting effort got corrected, of the turns that could be judged', () => {
  const entries = [entry(1, 'low', { corrected: true }), entry(2, 'low', { corrected: false }), entry(3, 'low'), entry(4, 'high', { corrected: false })]
  const text = summarize(entries, { timeoutMs: 1500, minDowngradeConfidence: 0.6, effortCloseMargin: 0.15, minHighConfidence: 0.5 })
  expect(text).toContain('| Corrected by you |')
  expect(text).toContain('| low | 3 | 0% | 50% of 2 |')
  expect(text).toContain('| high | 1 | 0% | 0% of 1 |')
})

test('cheap starts you keep correcting make jev-pilot lean up, as raises do', () => {
  const config = { timeoutMs: 1500, minDowngradeConfidence: 0.6, effortCloseMargin: 0.15, minHighConfidence: 0.5 }
  const corrected = Array.from({ length: 20 }, (_, i) => entry(i + 1, 'low', { corrected: i < 6 }))
  const found = suggestions(corrected, config)
  expect(found.map((f) => f.option)).toContain('minDowngradeConfidence')
  expect(found.find((f) => f.option === 'minDowngradeConfidence')?.why).toContain('corrected by you')
})
