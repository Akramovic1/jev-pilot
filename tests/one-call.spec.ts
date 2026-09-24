import { expect, test } from 'bun:test'
import { isContinuation, offerPart, stillOffered, takePart, type RouterPart } from '../hooks/jev-call.ts'
import { NO_SKILL, pickSkill, readWide, SURE_PICK, wideQuestions, WHICH_INSTRUCTIONS } from '../hooks/skill-suggestion.policy.ts'
import { questions, readDecision, requestBody } from '../hooks/model-router.policy.ts'

const part = (prompt: string): RouterPart => ({
  prompt,
  ask: async () => ({ text: null, miss: null, ms: 0 }),
  settle: async () => null,
})

// ---- the hand-off: the router's questions ride with the skill ranking ----------------

test("a part is taken once, and only for its own prompt", () => {
  const mine = part('fix the build')
  offerPart(mine)
  expect(takePart('something else')).toBeNull()
  // A wrong-prompt take clears it too: a stale part never reaches a later prompt.
  expect(takePart('fix the build')).toBeNull()
  offerPart(mine)
  expect(takePart('fix the build')).toBe(mine)
  expect(takePart('fix the build')).toBeNull()
})

test('the router can tell whether its part was left untaken, and clears it', () => {
  const mine = part('a')
  offerPart(mine)
  expect(stillOffered(mine)).toBe(true)
  expect(takePart('a')).toBeNull()
  offerPart(mine)
  takePart('a')
  expect(stillOffered(mine)).toBe(false)
})

test('one request body carries both modules\' questions, with nothing overwritten', () => {
  const skills = [{ name: 'pdf', description: 'Read and write PDFs.' }]
  const extra = wideQuestions('openrouter', skills, true, true)
  const body = JSON.parse(requestBody('openrouter', { prompt: 'x' }, 'm', true, false, [], false, extra))
  const router = Object.keys(questions('openrouter', true))
  for (const key of [...router, ...Object.keys(extra)]) expect(Object.keys(body.questions)).toContain(key)
  expect(router.filter((key) => key in extra)).toEqual([])
})

test('the answer to the one request reads for both: the decision and the ranking', () => {
  const text = JSON.stringify({
    answers: {
      tier: { type: 'choice', choice: 'balanced', probabilities: { balanced: 0.9 }, confidence: 0.9 },
      effort: { type: 'choice', choice: 'medium', probabilities: { medium: 1 }, confidence: 1 },
      which: { type: 'choice', choice: 'pdf', probabilities: { pdf: 0.9, [NO_SKILL]: 0.1 }, confidence: 0.9 },
    },
  })
  expect(readDecision(text)?.tier).toBe('balanced')
  expect(readWide(text)?.ranked[0]?.name).toBe('pdf')
})

// ---- the skill pick, from the one request ------------------------------------------

const skills = [
  { name: 'pdf', description: '' },
  { name: 'systematic-debugging', description: '' },
  { name: 'brainstorming', description: '' },
]
const config = { shortlist: 3, gateThreshold: 0.3, fitsThreshold: 0.3 }
const wide = (ranked: [string, number][], gate: number | null) => ({
  ranked: ranked.map(([name, probability]) => ({ name, probability })),
  gate,
  gateValues: {},
})

test('"none" leading the ranking means no skill, however sure the gate is', () => {
  expect(pickSkill([wide([[NO_SKILL, 0.64], ['pdf', 0.07]], 0.71)], skills, config).name).toBeNull()
})

test('a sure pick stands even when the gate says no skill is needed', () => {
  expect(pickSkill([wide([['brainstorming', 0.82]], 0.09)], skills, config).name).toBe('brainstorming')
  expect(SURE_PICK).toBe(0.5)
})

test('an unsure pick needs the gate, and must still fit', () => {
  expect(pickSkill([wide([['systematic-debugging', 0.38]], 0.43)], skills, config).name).toBe('systematic-debugging')
  expect(pickSkill([wide([['systematic-debugging', 0.38]], 0.2)], skills, config).name).toBeNull()
  expect(pickSkill([wide([['systematic-debugging', 0.2]], 0.9)], skills, config).name).toBeNull()
})

test('batches: the best skill leading its batch wins; a batch led by "none" offers nothing', () => {
  const parts = [wide([[NO_SKILL, 0.9], ['pdf', 0.1]], 0.6), wide([['brainstorming', 0.7]], null)]
  expect(pickSkill(parts, skills, config).name).toBe('brainstorming')
  expect(pickSkill([wide([['pdf', 0.9]], 0.5), null], skills, config).name).toBeNull()
})

test('a name that is not a candidate is never picked', () => {
  expect(pickSkill([wide([['rm-rf-everything', 0.99]], 0.9)], skills, config).name).toBeNull()
})

test('the ranking offers "none" and asks for the kind of work, only when asked to', () => {
  const asked = wideQuestions('openrouter', skills, true, true) as { which: { criteria: Record<string, string>; instructions: string } }
  expect(Object.keys(asked.which.criteria)).toContain(NO_SKILL)
  expect(asked.which.instructions).toBe(WHICH_INSTRUCTIONS)
  const plain = wideQuestions('openrouter', skills, true) as { which: { criteria: Record<string, string> } }
  expect(Object.keys(plain.which.criteria)).not.toContain(NO_SKILL)
})

// ---- "continue" goes on without asking ---------------------------------------------

test('only a plain "go on" skips Jev; approvals and anything longer are asked', () => {
  for (const text of ['continue', 'Continue.', 'keep going', 'please continue', 'go on', 'carry on', 'resume', 'continue please'])
    expect(isContinuation(text)).toBe(true)
  for (const text of ['yes', 'go ahead', 'do it', 'ok', 'proceed', 'continue with the tests', 'continue?', 'fix all and continue'])
    expect(isContinuation(text)).toBe(false)
})
