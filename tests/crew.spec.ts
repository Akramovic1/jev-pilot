import { expect, test } from 'bun:test'
import {
  applyCrewCommand,
  crewNote,
  crewOf,
  JUNIOR_AGENT,
  juniorSpec,
  reviewerAgent,
  reviewerSpec,
  DEFAULT_SLOTS,
  describeCrew,
  juniorSlot,
  overridesOf,
  parseCrewCommand,
  reviews,
  routerTable,
  slotAlias,
  slotsOffered,
} from '../hooks/crew.ts'
import { codexVerdict, crewStarted, healthOf, initCrew, opencodeVerdict, router, setHealth } from '../hooks/crew-state.ts'
import { ensureCrew, registerCrew, type CrewIo } from '../hooks/crew-run.ts'
import { capabilityNote, questions, readDecision, requestBody } from '../hooks/model-router.policy.ts'
// @ts-expect-error: a plain .mjs module, for Node or Bun
import { slotOf } from '../router/jev-router.mjs'

// ---- the crew: slots, modes, roles ----------------------------------------------

test('by default: standard mode, alpha on DeepSeek V4.1 Flash, beta and gamma off, Codex reviews', () => {
  const crew = crewOf({})
  expect(crew.mode).toBe('standard')
  expect(crew.slots.map((slot) => [slot.name, slot.model])).toEqual([['alpha', 'deepseek/deepseek-v4.1-flash']])
  expect(DEFAULT_SLOTS.beta.model).toBe('')
  expect(crew.junior).toBe('alpha')
  expect(crew.reviewer).toBe('codex')
})

test('options set the slots and their descriptions; /jev changes win over the options', () => {
  const crew = crewOf({ betaModel: 'qwen/qwen-4-coder', betaWhen: 'Choose for tests.', mode: 'budget' })
  expect(crew.slots.map((slot) => slot.name)).toEqual(['alpha', 'beta'])
  expect(crew.slots[1]?.when).toBe('Choose for tests.')
  expect(crew.mode).toBe('budget')
  const changed = crewOf({ mode: 'budget' }, { mode: 'junior-lead', models: { alpha: '' } })
  expect(changed.mode).toBe('junior-lead')
  expect(changed.slots.map((slot) => slot.name)).toEqual([])
})

test('/jev commands about the crew parse; anything else is left to the switches', () => {
  expect(parseCrewCommand('mode budget')).toEqual({ kind: 'mode', mode: 'budget' })
  expect(parseCrewCommand('alpha deepseek/deepseek-v4.1-flash')).toEqual({ kind: 'model', slot: 'alpha', model: 'deepseek/deepseek-v4.1-flash' })
  expect(parseCrewCommand('beta ~deepseek/deepseek-flash-latest')).toEqual({ kind: 'model', slot: 'beta', model: '~deepseek/deepseek-flash-latest' })
  expect(parseCrewCommand('gamma off')).toEqual({ kind: 'model', slot: 'gamma', model: '' })
  expect(parseCrewCommand('junior beta')).toEqual({ kind: 'junior', slot: 'beta' })
  expect(parseCrewCommand('reviewer opencode')).toEqual({ kind: 'reviewer', reviewer: 'opencode' })
  expect(parseCrewCommand('models')).toEqual({ kind: 'show' })
  expect(parseCrewCommand('mode turbo')?.kind).toBe('unknown')
  expect(parseCrewCommand('alpha not-a-model')?.kind).toBe('unknown')
  expect(parseCrewCommand('skills off')).toBeNull()
  expect(parseCrewCommand('')).toBeNull()
})

test('commands apply to the overrides, and the store round-trips them; junk is dropped', () => {
  let overrides = applyCrewCommand({}, { kind: 'mode', mode: 'budget' })
  overrides = applyCrewCommand(overrides, { kind: 'model', slot: 'beta', model: 'qwen/qwen-4-coder' })
  expect(overridesOf(JSON.parse(JSON.stringify(overrides)))).toEqual(overrides)
  expect(overridesOf({ mode: 'turbo', junior: 'delta', reviewer: 'bard', models: { alpha: 3 } })).toEqual({ models: {} })
  expect(overridesOf('nonsense')).toEqual({})
})

test('custom models are offered only in the modes that use them, and only with the router up', () => {
  for (const mode of ['budget', 'junior-lead'] as const) expect(slotsOffered(crewOf({ mode }), true).length).toBe(1)
  for (const mode of ['standard', 'second-opinion', 'quality'] as const) expect(slotsOffered(crewOf({ mode }), true)).toEqual([])
  expect(slotsOffered(crewOf({ mode: 'budget' }), false)).toEqual([])
  expect(juniorSlot(crewOf({ mode: 'junior-lead' }), true)?.name).toBe('alpha')
  expect(juniorSlot(crewOf({ mode: 'budget' }), true)).toBeNull()
  expect(reviews(crewOf({ mode: 'second-opinion' }))).toBe(true)
  expect(reviews(crewOf({ mode: 'quality' }))).toBe(true)
  expect(reviews(crewOf({ mode: 'budget' }))).toBe(false)
})

test('the router table names each slot and its model, and nothing else (no keys)', () => {
  const table = JSON.parse(routerTable(crewOf({ betaModel: 'qwen/qwen-4-coder' })))
  expect(table).toEqual({ slots: { alpha: { model: 'deepseek/deepseek-v4.1-flash' }, beta: { model: 'qwen/qwen-4-coder' } } })
  expect(slotAlias('alpha')).toBe('jev-alpha')
})

test('/jev status shows the mode, every slot and the reviewer', () => {
  const text = describeCrew(crewOf({ mode: 'budget' }), false)
  expect(text).toContain('mode: budget')
  expect(text).toContain('alpha  deepseek/deepseek-v4.1-flash')
  expect(text).toContain('beta   off')
  expect(text).toContain('router not running')
  expect(text).toContain('reviewer: codex')
})

// ---- the router: which requests leave for OpenRouter ---------------------------

test('only a jev-<slot> name with a model goes to OpenRouter; Claude and unknown names pass through', () => {
  const table = { alpha: { model: 'deepseek/deepseek-v4.1-flash' }, beta: { model: '' } }
  expect(slotOf('jev-alpha', table)).toEqual({ name: 'alpha', model: 'deepseek/deepseek-v4.1-flash' })
  expect(slotOf('jev-beta', table)).toBeNull()
  expect(slotOf('jev-gamma', table)).toBeNull()
  expect(slotOf('claude-opus-5-5', table)).toBeNull()
  expect(slotOf('claude-haiku-4-5-20251001', table)).toBeNull()
  expect(slotOf(undefined, table)).toBeNull()
})

// ---- Jev: slots as choices ---------------------------------------------------------

test('offered slots take the cheap end of the model question, each saying what it is and when to choose it', () => {
  const slots = [{ name: 'alpha', model: 'deepseek/deepseek-v4.1-flash', when: 'Choose for bulk searching.' }]
  const tier = (questions('openrouter', false, true, slots) as Record<string, { criteria: Record<string, string> }>).tier
  // The custom models take Haiku's place at the cheap end, instead of competing with it.
  expect(Object.keys(tier?.criteria ?? {})).toEqual(['balanced', 'deep', 'alpha'])
  expect(tier?.criteria.alpha).toBe('deepseek/deepseek-v4.1-flash (a custom model, not Claude). Choose for bulk searching.')
  expect(JSON.parse(requestBody('openrouter', { prompt: 'x' }, 'm', false, true, slots)).questions.tier.criteria.alpha).toContain('custom model')
  expect(Object.keys((questions('openrouter') as Record<string, { criteria: Record<string, string> }>).tier?.criteria ?? {})).toEqual(['fast', 'balanced', 'deep'])
})

test('a slot picked for a subagent reads as the cheapest tier with the slot named; unoffered names are refused', () => {
  const answer = (choice: string) =>
    JSON.stringify({ answers: { tier: { type: 'choice', choice, probabilities: { [choice]: 0.9 }, confidence: 0.9 }, effort: { type: 'choice', choice: 'low', probabilities: { low: 1 }, confidence: 1 } } })
  const picked = readDecision(answer('alpha'), ['alpha'])
  expect(picked?.tier).toBe('fast')
  expect(picked?.slot).toBe('alpha')
  expect(readDecision(answer('alpha'), [])).toBeNull()
  expect(readDecision(answer('deep'), ['alpha'])?.slot).toBeUndefined()
})

// ---- health: each worker proves it's working ---------------------------------------

test('Codex is working when it says it is logged in', () => {
  expect(codexVerdict(0, 'Logged in using ChatGPT\n').ok).toBe(true)
  expect(codexVerdict(0, 'Logged in using ChatGPT\n').detail).toBe('Logged in using ChatGPT')
  expect(codexVerdict(1, 'Not logged in').ok).toBe(false)
  expect(codexVerdict(0, 'Not logged in').ok).toBe(false)
})

test('OpenCode is working when it runs and has a provider logged in', () => {
  const auth = '\u001b[0m\n┌  Credentials \u001b[90m~/.local/share/opencode/auth.json\n│\n●  GitHub Copilot \u001b[90moauth\n│\n●  Fireworks AI \u001b[90mapi\n'
  const ok = opencodeVerdict(0, '1.18.30\n', auth)
  expect(ok.ok).toBe(true)
  expect(ok.detail).toBe('opencode 1.18.30 · GitHub Copilot, Fireworks AI')
  expect(opencodeVerdict(0, '1.18.30', '┌  Credentials\n└  0 credentials').ok).toBe(false)
  expect(opencodeVerdict(127, '', '').ok).toBe(false)
})

// ---- the junior and the reviewers as agent types -----------------------------------

test('the junior writes code on its slot; a reviewer only relays, with Bash alone', () => {
  const junior = juniorSpec('jev-alpha')
  expect(`jev-pilot:${junior.name}`).toBe(JUNIOR_AGENT)
  expect(junior.model).toBe('jev-alpha')
  expect(junior.tools).toContain('Edit')
  for (const reviewer of ['codex', 'opencode'] as const) {
    const spec = reviewerSpec(reviewer, 'haiku')
    expect(`jev-pilot:${spec.name}`).toBe(reviewerAgent(reviewer))
    expect(spec.tools).toEqual(['Bash'])
    expect(spec.model).toBe('haiku')
  }
})

test('reviews run read-only: Codex in its read-only sandbox, OpenCode as its plan agent', () => {
  const codex = reviewerSpec('codex', 'haiku').prompt
  expect(codex).toContain('codex exec -s read-only')
  expect(codex).not.toMatch(/workspace-write|danger-full-access|--dangerously/)
  const opencode = reviewerSpec('opencode', 'haiku').prompt
  expect(opencode).toContain('opencode run --agent plan')
  expect(opencode).not.toContain('--auto')
  // The brief goes in through a quoted heredoc, so nothing in it runs in the shell.
  for (const prompt of [codex, opencode]) expect(prompt).toContain("<<'JEV_BRIEF'")
})

// ---- the note to the main model --------------------------------------------------

test('standard mode with no reviewer working adds nothing to the note', () => {
  expect(crewNote(crewOf({}), null, [])).toEqual([])
})

test('second-opinion mode tells the model to spawn the chosen reviewer, or the other when it is down', () => {
  const crew = crewOf({ mode: 'second-opinion', reviewer: 'codex' })
  expect(crewNote(crew, null, ['codex', 'opencode']).join('\n')).toContain('spawn jev-pilot:codex-review')
  expect(crewNote(crew, null, ['opencode']).join('\n')).toContain('spawn jev-pilot:opencode-review')
  const none = crewNote(crew, null, []).join('\n')
  expect(none).not.toContain('spawn')
  expect(none).toContain('No external reviewer is working')
})

test('junior-lead mode names the junior and its model; the note carries the crew lines', () => {
  const crew = crewOf({ mode: 'junior-lead' })
  const lines = crewNote(crew, crew.slots[0] ?? null, [])
  expect(lines.join('\n')).toContain(`${JUNIOR_AGENT} is a junior developer on deepseek/deepseek-v4.1-flash`)
  const off = { effort: false, raise: false, subagents: false, subagentEffort: false, skills: false, strategy: false, model: false }
  expect(capabilityNote(off)).toBeNull()
  const note = capabilityNote(off, lines) ?? ''
  expect(note).toContain('<jev_pilot>')
  expect(note).toContain('junior-lead mode')
})

// ---- a reload mid-session --------------------------------------------------------

function fakeIo(registered: string[]): CrewIo {
  return {
    fetch: async (url) => ({ ok: url.endsWith('/jev-router/health'), status: 200, text: '' }),
    home: async () => '/home/test',
    routerUrl: async () => 'http://127.0.0.1:8799',
    write: async () => undefined,
    run: async (argv) => (argv[0] === 'codex' ? { exitCode: 0, stdout: 'Logged in using ChatGPT', stderr: '' } : { exitCode: 127, stdout: '', stderr: '' }),
    storeGet: async () => ({ mode: 'junior-lead' }),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    register: async (spec) => {
      registered.push(spec.name)
    },
  }
}

test('after a reload the crew is set up again on first use: router, saved mode, junior, reviewers', async () => {
  initCrew({})
  expect(crewStarted()).toBe(false)
  expect(router()).toBeNull()
  const registered: string[] = []
  await ensureCrew(fakeIo(registered), null)
  expect(crewStarted()).toBe(true)
  expect(router()).toBe('http://127.0.0.1:8799')
  expect(registered).toContain('junior')
  // The checks run in the background; once they're in, the working reviewer registers.
  for (let i = 0; i < 50 && !registered.includes('codex-review'); i++) await new Promise((resolve) => setTimeout(resolve, 10))
  expect(healthOf('agent:codex')?.ok).toBe(true)
  expect(registered).toContain('codex-review')
  expect(registered).not.toContain('opencode-review')
  // Once started, nothing runs again.
  const again: string[] = []
  await ensureCrew(fakeIo(again), null)
  expect(again).toEqual([])
})

test('only reviewers that passed their check are registered', async () => {
  initCrew({})
  setHealth('agent:codex', { ok: false, detail: 'not logged in', at: 0 })
  setHealth('agent:opencode', { ok: true, detail: 'opencode 1.18.30', at: 0 })
  const registered: string[] = []
  await registerCrew(fakeIo(registered))
  expect(registered).toEqual(['opencode-review'])
})
