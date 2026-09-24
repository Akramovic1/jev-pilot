import { expect, test } from 'bun:test'
import {
  applyCrewCommand,
  crewNote,
  crewOf,
  JUNIOR_AGENT,
  juniorSpec,
  reviewerAgent,
  reviewerSpec,
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

test('by default: standard mode, no custom model set (you choose one), Codex reviews', () => {
  const crew = crewOf({})
  expect(crew.mode).toBe('standard')
  expect(crew.slots).toEqual([])
  expect(crew.junior).toBe('')
  expect(crew.reviewer).toBe('codex')
})

test('options set the slots and their descriptions; /jev changes win over the options', () => {
  const crew = crewOf({ alphaModel: 'deepseek/deepseek-v4.1-flash', betaModel: 'qwen/qwen-4-coder', betaWhen: 'Choose for tests.', mode: 'budget' })
  expect(crew.slots.map((slot) => slot.name)).toEqual(['alpha', 'beta'])
  expect(crew.slots[1]?.when).toBe('Choose for tests.')
  expect(crew.mode).toBe('budget')
  const changed = crewOf({ mode: 'budget', alphaModel: 'deepseek/deepseek-v4.1-flash' }, { mode: 'junior-lead', models: { alpha: '' } })
  expect(changed.mode).toBe('junior-lead')
  expect(changed.slots.map((slot) => slot.name)).toEqual([])
})

test('/jev commands about the crew parse; anything else is left to the switches', () => {
  expect(parseCrewCommand('mode budget')).toEqual({ kind: 'mode', mode: 'budget' })
  // Any name you choose; what follows it is a paste, checked against OpenRouter's list before it's set.
  expect(parseCrewCommand('flash deepseek/deepseek-v4.1-flash')).toEqual({ kind: 'paste', slot: 'flash', input: 'deepseek/deepseek-v4.1-flash' })
  expect(parseCrewCommand('Coder DeepSeek: DeepSeek V4.1 Flash')).toEqual({ kind: 'paste', slot: 'coder', input: 'DeepSeek: DeepSeek V4.1 Flash' })
  expect(parseCrewCommand('my-coder off')).toEqual({ kind: 'model', slot: 'my-coder', model: '' })
  expect(parseCrewCommand('flash')).toEqual({ kind: 'slot', slot: 'flash' })
  expect(parseCrewCommand('junior coder')).toEqual({ kind: 'junior', slot: 'coder' })
  expect(parseCrewCommand('reviewer opencode')).toEqual({ kind: 'reviewer', reviewer: 'opencode' })
  expect(parseCrewCommand('models')).toEqual({ kind: 'show' })
  expect(parseCrewCommand('mode turbo')?.kind).toBe('unknown')
  // A switch is never taken for a model's name.
  expect(parseCrewCommand('skills off')).toBeNull()
  expect(parseCrewCommand('all on')).toBeNull()
  expect(parseCrewCommand('reset')).toBeNull()
  expect(parseCrewCommand('')).toBeNull()
})

test('commands apply to the overrides, and the store round-trips them; junk is dropped', () => {
  let overrides = applyCrewCommand({}, { kind: 'mode', mode: 'budget' })
  overrides = applyCrewCommand(overrides, { kind: 'model', slot: 'coder', model: 'qwen/qwen-4-coder', about: 'Qwen: Qwen 4 Coder' })
  expect(overridesOf(JSON.parse(JSON.stringify(overrides)))).toEqual(overrides)
  expect(overridesOf({ mode: 'turbo', junior: 'Not A Name', reviewer: 'bard', models: { alpha: 3, skills: 'a/b', 'Bad Name': 'a/b', ok: 'not an id' } })).toEqual({ models: {} })
  expect(overridesOf('nonsense')).toEqual({})
})

test('custom models are offered only in the modes that use them, and only with the router up', () => {
  const alpha = { alphaModel: 'deepseek/deepseek-v4.1-flash' }
  for (const mode of ['budget', 'junior-lead'] as const) expect(slotsOffered(crewOf({ mode, ...alpha }), true).length).toBe(1)
  for (const mode of ['standard', 'second-opinion', 'quality'] as const) expect(slotsOffered(crewOf({ mode, ...alpha }), true)).toEqual([])
  expect(slotsOffered(crewOf({ mode: 'budget', ...alpha }), false)).toEqual([])
  expect(juniorSlot(crewOf({ mode: 'junior-lead', ...alpha }), true)?.name).toBe('alpha')
  expect(juniorSlot(crewOf({ mode: 'junior-lead' }), true)).toBeNull()
  expect(juniorSlot(crewOf({ mode: 'budget', ...alpha }), true)).toBeNull()
  expect(reviews(crewOf({ mode: 'second-opinion' }))).toBe(true)
  expect(reviews(crewOf({ mode: 'quality' }))).toBe(true)
  expect(reviews(crewOf({ mode: 'budget' }))).toBe(false)
})

test('the router table names each slot and its model (unset ones as ""), the models set before, and nothing else (no keys)', () => {
  const overrides = { models: { flash: 'deepseek/deepseek-v4.1-flash', old: '' }, recent: ['qwen/qwen-4-coder'], about: { 'deepseek/deepseek-v4.1-flash': 'DeepSeek: DeepSeek V4.1 Flash · $0.14 in' } }
  const table = JSON.parse(routerTable(crewOf({}, overrides), overrides))
  expect(table).toEqual({
    slots: { old: { model: '' }, flash: { model: 'deepseek/deepseek-v4.1-flash', about: 'DeepSeek: DeepSeek V4.1 Flash · $0.14 in' } },
    recent: ['qwen/qwen-4-coder'],
  })
  expect(slotAlias('alpha')).toBe('jev-alpha')
})

test('/jev status shows the mode, every slot and the reviewer', () => {
  const text = describeCrew(crewOf({ mode: 'budget', alphaModel: 'deepseek/deepseek-v4.1-flash' }), false)
  expect(text).toContain('mode: budget')
  expect(text).toContain('alpha  deepseek/deepseek-v4.1-flash')
  expect(text).not.toContain('beta')
  expect(describeCrew(crewOf({}), false)).toContain('none yet')
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
  expect(codex).toContain('codex exec "$@" -s read-only')
  expect(codex).not.toMatch(/workspace-write|danger-full-access|--dangerously/)
  const opencode = reviewerSpec('opencode', 'haiku').prompt
  expect(opencode).toContain('opencode run "$@" --agent plan')
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
  const crew = crewOf({ mode: 'junior-lead', alphaModel: 'deepseek/deepseek-v4.1-flash' })
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
    read: async () => null,
    run: async (argv) => (argv[0] === 'codex' ? { exitCode: 0, stdout: 'Logged in using ChatGPT', stderr: '' } : { exitCode: 127, stdout: '', stderr: '' }),
    storeGet: async () => ({ mode: 'junior-lead', models: { alpha: 'deepseek/deepseek-v4.1-flash' } }),
    // The checks' time limits never run out here: every answer is immediate.
    sleep: () => new Promise<void>(() => undefined),
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
  for (let i = 0; i < 200 && !registered.includes('codex-review'); i++) await Promise.resolve()
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

// ---- the router's fallback -----------------------------------------------------------

test('the router falls back to the Sonnet it has seen, else any Claude it has seen, else the one set', async () => {
  // @ts-expect-error: a plain .mjs module
  const { learnModel, fallbackModel } = await import('../router/jev-router.mjs')
  const seen = { sonnet: null, any: null }
  expect(fallbackModel(seen, {})).toBeNull()
  expect(learnModel('jev-alpha', seen)).toBe(false)
  expect(learnModel('claude-opus-5-5', seen)).toBe(true)
  expect(fallbackModel(seen, {})).toBe('claude-opus-5-5')
  learnModel('claude-sonnet-5', seen)
  learnModel('claude-haiku-4-5-20251001', seen)
  expect(fallbackModel(seen, {})).toBe('claude-sonnet-5')
  expect(fallbackModel(seen, { JEV_ROUTER_FALLBACK_MODEL: 'claude-opus-5-5' })).toBe('claude-opus-5-5')
})

test('/jev status names each custom model that fell back, and why', async () => {
  const { fallbackNote } = await import('../hooks/crew-run.ts')
  const health = JSON.stringify({ ok: true, fallbacks: { alpha: { count: 2, to: 'claude-sonnet-5', why: 'OpenRouter 503: busy' } } })
  expect(fallbackNote(health)).toBe(' · alpha fell back to claude-sonnet-5 2× (last: OpenRouter 503: busy)')
  expect(fallbackNote(JSON.stringify({ ok: true, fallbacks: {} }))).toBe('')
  expect(fallbackNote('not json')).toBe('')
})

test('a slot not checked yet may be used (the router falls back if it fails); one that failed may not', async () => {
  const { slotUsable } = await import('../hooks/crew-state.ts')
  const alpha = { name: 'alpha', model: 'deepseek/deepseek-v4.1-flash', when: '' }
  initCrew({})
  expect(slotUsable(alpha)).toBe(true)
  setHealth('slot:alpha', { ok: false, detail: 'deepseek/deepseek-v4.1-flash · HTTP 404', at: 0 })
  expect(slotUsable(alpha)).toBe(false)
  // A failed check of the slot's old model says nothing about its new one.
  expect(slotUsable({ ...alpha, model: 'qwen/qwen3-coder' })).toBe(true)
  setHealth('slot:alpha', { ok: true, detail: 'deepseek/deepseek-v4.1-flash · answering', at: 0 })
  expect(slotUsable(alpha)).toBe(true)
})

// ---- setting a slot by pasting from OpenRouter ----------------------------------------

const catalog = [
  {
    id: 'deepseek/deepseek-v4.1-flash',
    name: 'DeepSeek: DeepSeek V4.1 Flash',
    canonical_slug: 'deepseek/deepseek-v4.1-flash-20260910',
    context_length: 1048576,
    pricing: { prompt: '0.00000014', completion: '0.00000042' },
    supported_parameters: ['tools', 'tool_choice'],
  },
  { id: 'qwen/qwen3-coder', name: 'Qwen: Qwen3 Coder', context_length: 262144, pricing: { prompt: '0.0000002', completion: '0.0000008' }, supported_parameters: ['tools'] },
  { id: 'tencent/hy-mt2-7b', name: 'Tencent: HY MT2 7B', supported_parameters: ['temperature'] },
]

test('a model is found by its id, page link, dated slug or name, however it was pasted', async () => {
  const { resolveModel } = await import('../hooks/crew.ts')
  for (const pasted of [
    'deepseek/deepseek-v4.1-flash',
    '  `deepseek/deepseek-v4.1-flash`  ',
    'https://openrouter.ai/deepseek/deepseek-v4.1-flash',
    'openrouter.ai/deepseek/deepseek-v4.1-flash/providers',
    'https://openrouter.ai/models/deepseek/deepseek-v4.1-flash?tab=api',
    'deepseek/deepseek-v4.1-flash-20260910',
    'DeepSeek: DeepSeek V4.1 Flash',
    'deepseek v4.1 flash',
  ]) {
    const found = resolveModel(pasted, catalog)
    expect(found.ok ? found.id : `${pasted}: ${found.why}`).toBe('deepseek/deepseek-v4.1-flash')
  }
  const about = resolveModel('qwen/qwen3-coder', catalog)
  expect(about.ok && about.about).toBe('Qwen: Qwen3 Coder · 262k context · $0.2 in · $0.8 out per million tokens')
})

test('an unknown model is refused with the closest ones to try; one that cannot call tools is refused', async () => {
  const { resolveModel } = await import('../hooks/crew.ts')
  const unknown = resolveModel('deepseek/deepseek-v9', catalog)
  expect(unknown.ok).toBe(false)
  expect(!unknown.ok && unknown.suggestions).toEqual(['deepseek/deepseek-v4.1-flash'])
  const noTools = resolveModel('tencent/hy-mt2-7b', catalog)
  expect(!noTools.ok && noTools.why).toContain("can't call tools")
  expect(resolveModel('   ', catalog).ok).toBe(false)
})

test("OpenRouter's list unreachable: an id is taken as is, anything else is refused", async () => {
  const { resolveModel } = await import('../hooks/crew.ts')
  expect(resolveModel('some/new-model', null)).toMatchObject({ ok: true, id: 'some/new-model' })
  expect(resolveModel('Some Model Name', null).ok).toBe(false)
})

test('each model set is remembered, newest first, so switching back is one command', async () => {
  const { applyCrewCommand, describeSlot, RECENT_MODELS } = await import('../hooks/crew.ts')
  let overrides = {}
  for (const model of ['a/one', 'b/two', 'a/one', 'c/three']) overrides = applyCrewCommand(overrides, { kind: 'model', slot: 'alpha', model })
  expect((overrides as { recent: string[] }).recent).toEqual(['c/three', 'a/one', 'b/two'])
  overrides = applyCrewCommand(overrides, { kind: 'model', slot: 'alpha', model: '' })
  expect((overrides as { recent: string[] }).recent).toEqual(['c/three', 'a/one', 'b/two'])
  // Stored and read back (another session), junk dropped.
  expect(overridesOf(JSON.parse(JSON.stringify({ ...overrides, recent: ['c/three', 42, 'not an id'] }))).recent).toEqual(['c/three'])
  for (let i = 0; i < 9; i++) overrides = applyCrewCommand(overrides, { kind: 'model', slot: 'beta', model: `p/m${i}` })
  expect((overrides as { recent: string[] }).recent.length).toBe(RECENT_MODELS)
  const text = describeSlot(crewOf({}, { models: { alpha: 'c/three' } }), 'alpha', ['c/three', 'a/one'])
  expect(text).toContain('alpha: c/three')
  expect(text).toContain('/jev alpha a/one')
  expect(text).not.toContain('/jev alpha c/three')
  expect(describeSlot(crewOf({}), 'beta')).toContain('beta: no model by that name yet')
})

// ---- one record for every session --------------------------------------------------

test('models.json is read back as the models set, whatever else the file holds', async () => {
  const { recordedModels } = await import('../hooks/crew.ts')
  const text = JSON.stringify({ slots: { flash: { model: 'deepseek/deepseek-v4.1-flash', about: 'DeepSeek V4.1 Flash' }, old: { model: '' }, bad: { model: 'rm -rf /' }, 'NOT OK': { model: 'a/b' } }, recent: ['deepseek/deepseek-v4.1-flash'] })
  expect(recordedModels(text)).toEqual({ models: { flash: 'deepseek/deepseek-v4.1-flash', old: '' }, recent: ['deepseek/deepseek-v4.1-flash'], about: { 'deepseek/deepseek-v4.1-flash': 'DeepSeek V4.1 Flash' }, reviewerChoices: {} })
  expect(recordedModels(null)).toBeNull()
  expect(recordedModels('not json')).toBeNull()
  expect(recordedModels('{"other": 1}')).toBeNull()
  // What one session writes, the next reads back unchanged.
  const set = { models: { coder: 'qwen/qwen3-coder' }, recent: ['qwen/qwen3-coder'] }
  expect(recordedModels(routerTable(crewOf({}, set), set))).toEqual({ models: { coder: 'qwen/qwen3-coder' }, recent: ['qwen/qwen3-coder'], reviewerChoices: {} })
})

test('a session starts with the models recorded in models.json, over its own store; the mode stays its own', async () => {
  initCrew({})
  const recorded = { models: { alpha: 'qwen/qwen3-coder' }, recent: ['qwen/qwen3-coder'] }
  const file = routerTable(crewOf({}, recorded), recorded)
  const io = { ...fakeIo([]), read: async () => file, storeGet: async () => ({ mode: 'budget', models: { alpha: 'old/model' } }) }
  await ensureCrew(io, null)
  const { crew } = await import('../hooks/crew-state.ts')
  expect(crew().mode).toBe('budget')
  expect(crew().slots.map((slot) => slot.model)).toEqual(['qwen/qwen3-coder'])
})

test('a model set in another session reaches this one at its next prompt', async () => {
  initCrew({})
  let file = routerTable(crewOf({}), {})
  const io = { ...fakeIo([]), read: async () => file }
  await ensureCrew(io, null)
  const { crew } = await import('../hooks/crew-state.ts')
  expect(crew().slots).toEqual([])
  const set = { models: { coder: 'qwen/qwen3-coder' }, recent: ['qwen/qwen3-coder'] }
  file = routerTable(crewOf({}, set), set)
  await ensureCrew(io, null)
  expect(crew().slots.map((slot) => [slot.name, slot.model])).toEqual([['coder', 'qwen/qwen3-coder']])
})

// ---- names you choose, removing, and /model ------------------------------------------

test('a name is yours to choose, but never a word /jev already means', async () => {
  const { validName, RESERVED_NAMES } = await import('../hooks/crew.ts')
  for (const name of ['flash', 'coder', 'my-coder', 'q3', 'alpha']) expect(validName(name)).toBe(true)
  for (const name of ['skills', 'status', 'mode', 'remove', 'off', 'all', 'tune', '3d', '-x', 'Flash', 'a b', 'x'.repeat(25)]) expect(validName(name)).toBe(false)
  expect(RESERVED_NAMES.has('pet')).toBe(true)
})

test('remove deletes a model everywhere: from the crew, the junior, the record; a setting cannot bring it back', async () => {
  const { juniorSlot } = await import('../hooks/crew.ts')
  expect(parseCrewCommand('remove flash')).toEqual({ kind: 'model', slot: 'flash', model: '' })
  expect(parseCrewCommand('delete flash')).toEqual({ kind: 'model', slot: 'flash', model: '' })
  expect(parseCrewCommand('remove')?.kind).toBe('unknown')
  let overrides = applyCrewCommand({ junior: 'flash' }, { kind: 'model', slot: 'flash', model: 'deepseek/deepseek-v4.1-flash' })
  overrides = applyCrewCommand(overrides, { kind: 'model', slot: 'coder', model: 'qwen/qwen3-coder' })
  expect(crewOf({ mode: 'junior-lead' }, overrides).junior).toBe('flash')
  overrides = applyCrewCommand(overrides, { kind: 'model', slot: 'flash', model: '' })
  const after = crewOf({ mode: 'junior-lead' }, overrides)
  expect(after.slots.map((slot) => slot.name)).toEqual(['coder'])
  // The junior moves to a model that's still there.
  expect(juniorSlot(after, true)?.name).toBe('coder')
  // A model from the old alphaModel setting, removed with /jev, stays removed.
  expect(crewOf({ alphaModel: 'a/b' }, applyCrewCommand({}, { kind: 'model', slot: 'alpha', model: '' })).slots).toEqual([])
  expect(crewOf({ alphaModel: 'a/b' }).slots.map((slot) => slot.name)).toEqual(['alpha'])
})

test('each custom model is a row in /model, as jev-<name>, handled like Sonnet by Claude Code', async () => {
  const { pickerSettings } = await import('../hooks/crew.ts')
  const crew = crewOf({}, {
    models: { flash: 'deepseek/deepseek-v4.1-flash', gone: '' },
    about: { 'deepseek/deepseek-v4.1-flash': 'DeepSeek: DeepSeek V4.1 Flash · 1M context · $0.14 in · $0.42 out per million tokens' },
  })
  expect(JSON.parse(pickerSettings(crew))).toEqual({
    modelPicker: {
      options: [
        {
          model: 'jev-flash',
          label: 'flash · DeepSeek V4.1 Flash',
          description: 'deepseek/deepseek-v4.1-flash on OpenRouter · $0.14 in · $0.42 out per million tokens · claude-jev only',
          behavesAs: 'sonnet',
        },
      ],
    },
  })
  expect(JSON.parse(pickerSettings(crewOf({})))).toEqual({ modelPicker: { options: [] } })
})

test('the router serves any name, hyphens included, and nothing removed', () => {
  const table = { flash: { model: 'deepseek/deepseek-v4.1-flash' }, 'my-coder': { model: 'qwen/qwen3-coder' }, old: { model: '' } }
  expect(slotOf('jev-my-coder', table)).toEqual({ name: 'my-coder', model: 'qwen/qwen3-coder' })
  expect(slotOf('jev-flash', table)).toEqual({ name: 'flash', model: 'deepseek/deepseek-v4.1-flash' })
  expect(slotOf('jev-old', table)).toBeNull()
  expect(slotOf('jev-', table)).toBeNull()
})

// ---- what a custom model on OpenRouter is sent ---------------------------------------

test('what is Anthropic\'s alone never reaches OpenRouter: account ids, safeguards, context management', async () => {
  // @ts-expect-error: a plain .mjs module
  const { forOpenRouter } = await import('../router/jev-router.mjs')
  const body = {
    model: 'jev-coder',
    max_tokens: 100,
    stream: true,
    system: [{ type: 'text', text: 'sys' }],
    metadata: { user_id: '{"device_id":"d","account_uuid":"a"}' },
    safeguards: [{ type: 'dangerous_tool_use', classifier_context: { rules: 'private' } }],
    context_management: { edits: [] },
    messages: [{ role: 'user', content: 'hi' }],
    tools: [{ name: 'Bash', description: 'b', input_schema: {} }],
  }
  const sent = forOpenRouter(body, 'qwen/qwen3-coder')
  expect(sent.model).toBe('qwen/qwen3-coder')
  for (const key of ['metadata', 'safeguards', 'context_management']) expect(key in sent).toBe(false)
  expect(JSON.stringify(sent)).not.toContain('account_uuid')
  expect(JSON.stringify(sent)).not.toContain('private')
  // The request Claude Code built is left as it was (the fallback to Claude sends it whole).
  expect(body.metadata).toBeDefined()
})

test('tool search becomes plain tools: deferred ones sent in full, announced ones added, references dropped', async () => {
  // @ts-expect-error: a plain .mjs module
  const { forOpenRouter } = await import('../router/jev-router.mjs')
  const sent = forOpenRouter(
    {
      messages: [
        { role: 'user', content: [{ type: 'tool_addition', tool: { name: 'mcp__docs__read', description: 'r', input_schema: {}, defer_loading: true } }] },
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'ToolSearch', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'tool_reference', tool_name: 'mcp__docs__read' }, { type: 'text', text: 'found' }] }] },
      ],
      tools: [
        { name: 'Bash', description: 'b', input_schema: {} },
        { name: 'mcp__docs__guide', description: 'g', input_schema: {}, defer_loading: true },
        { name: 'DeferredToolPlaceholder', description: 'p', input_schema: {}, defer_loading: true },
        { type: 'web_search_20250305', name: 'web_search' },
      ],
    },
    'm/x',
  )
  expect(sent.tools.map((tool: { name: string }) => tool.name)).toEqual(['Bash', 'mcp__docs__guide', 'mcp__docs__read'])
  expect(JSON.stringify(sent)).not.toContain('defer_loading')
  expect(JSON.stringify(sent)).not.toContain('tool_reference')
  expect(JSON.stringify(sent)).not.toContain('tool_addition')
  // The message that only announced a tool keeps its turn.
  expect(sent.messages[0].content).toEqual([{ type: 'text', text: '(tools updated)' }])
  expect(sent.messages[2].content[0].content).toEqual([{ type: 'text', text: 'found' }])
})

test('a custom model that fell back is reported once, and only what is new', async () => {
  const { newFallbacks } = await import('../hooks/crew-run.ts')
  const { setRouter } = await import('../hooks/crew-state.ts')
  initCrew({})
  setRouter('http://127.0.0.1:8799')
  let fallbacks: Record<string, unknown> = {}
  const io = {
    fetch: async () => ({ ok: true, status: 200, text: JSON.stringify({ ok: true, fallbacks }) }),
    sleep: () => new Promise<void>(() => undefined),
  }
  expect(await newFallbacks(io)).toEqual([]) // the first look only counts
  fallbacks = { coder: { count: 1, to: 'claude-sonnet-5', why: 'OpenRouter 503: busy' } }
  expect(await newFallbacks(io)).toEqual(['coder failed (OpenRouter 503: busy), so claude-sonnet-5 answered instead'])
  expect(await newFallbacks(io)).toEqual([])
})

test('workflow agents: the note says to set their model in the script, custom models included in budget mode', () => {
  const crew = crewOf({ mode: 'budget' }, { models: { flash: 'deepseek/deepseek-v4.1-flash' } })
  const text = crewNote(crew, null, [], crew.slots, true).join('\n')
  expect(text).toContain('opts.model')
  expect(text).toContain("opts.model: 'jev-flash' (deepseek/deepseek-v4.1-flash)")
  expect(crewNote(crewOf({}), null, [], [], true).join('\n')).not.toContain("'jev-")
  expect(crewNote(crewOf({}), null, [], [], false)).toEqual([])
})

// ---- the review's fixes ------------------------------------------------------------

test('the router serves only requests under its secret, and never a browser', async () => {
  // @ts-expect-error: a plain .mjs module
  const { admit } = await import('../router/jev-router.mjs')
  const secret = '0123456789abcdef0123456789abcdef'
  expect(admit(`/${secret}/v1/messages?beta=true`, {}, secret)).toEqual({ path: '/v1/messages?beta=true' })
  expect(admit(`/${secret}/jev-router/health`, {}, secret)).toEqual({ path: '/jev-router/health' })
  // No secret, a wrong one, or one that is only a prefix of the path segment: nothing.
  expect(admit('/v1/messages', {}, secret)).toEqual({ status: 404 })
  expect(admit('/jev-router/stop', {}, secret)).toEqual({ status: 404 })
  expect(admit(`/${secret}x/v1/messages`, {}, secret)).toEqual({ status: 404 })
  // A web page's request (it names an Origin, or the fetch metadata a browser adds): refused.
  expect(admit(`/${secret}/v1/messages`, { origin: 'https://evil.example' }, secret)).toEqual({ status: 403 })
  expect(admit(`/${secret}/v1/messages`, { 'sec-fetch-site': 'cross-site' }, secret)).toEqual({ status: 403 })
  // No secret set up: the router serves nothing.
  expect(admit('/anything', {}, '')).toEqual({ status: 503 })
})

test('the router address is shown without its secret', async () => {
  const { shownUrl } = await import('../hooks/crew-run.ts')
  expect(shownUrl('http://127.0.0.1:8799/0123456789abcdef0123456789abcdef')).toBe('http://127.0.0.1:8799')
  expect(shownUrl('http://127.0.0.1:8799')).toBe('http://127.0.0.1:8799')
})

test('a record written elsewhere with too many models: the first eight count', () => {
  const models = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`m${i}`, `p/model-${i}`]))
  const crew = crewOf({}, overridesOf({ models }))
  expect(crew.slots.length).toBe(8)
  expect(crew.slots[0]?.name).toBe('m0')
  expect(Object.keys(overridesOf({ models }).models ?? {}).length).toBe(64)
})

test('commands with a fixed number of words refuse extra ones', () => {
  expect(parseCrewCommand('mode quality garbage')?.kind).toBe('unknown')
  expect(parseCrewCommand('junior flash garbage')?.kind).toBe('unknown')
  expect(parseCrewCommand('reviewer codex luna high extra')?.kind).toBe('unknown')
  expect(parseCrewCommand('models extra')?.kind).toBe('unknown')
  expect(parseCrewCommand('remove flash extra')?.kind).toBe('unknown')
  expect(parseCrewCommand('mode quality')).toEqual({ kind: 'mode', mode: 'quality' })
})

test('the router takes a models table only when it is one; anything else leaves the last good table', async () => {
  // @ts-expect-error: a plain .mjs module
  const { validTable } = await import('../router/jev-router.mjs')
  expect(validTable({ flash: { model: 'deepseek/deepseek-v4.1-flash', about: 'x' }, old: { model: '' } })).toEqual({
    flash: { model: 'deepseek/deepseek-v4.1-flash' },
    old: { model: '' },
  })
  for (const bad of [[], 'x', null, { flash: 'deepseek/x' }, { flash: { model: 'not an id' } }, { 'Bad Name': { model: 'a/b' } }, Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`m${i}`, { model: 'a/b' }]))]) {
    expect(validTable(bad)).toBeNull()
  }
})

// ---- the reviewers' models: Codex tiers, always the newest ------------------------------

const codexList = JSON.stringify([
  { slug: 'gpt-6-astra', display_name: 'GPT-6-Astra', description: 'Frontier', visibility: 'list', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }, { effort: 'ultra' }] },
  { slug: 'gpt-5.6-sol', display_name: 'GPT-5.6-Sol', description: 'Complex work', visibility: 'list', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }] },
  { slug: 'gpt-5.6-luna', display_name: 'GPT-5.6-Luna', description: 'Fast', visibility: 'list', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }] },
  { slug: 'codex-auto-review', display_name: 'Auto', description: 'hidden', visibility: 'hide', supported_reasoning_levels: [] },
])

test("Codex's list is read as it shows it: hidden models left out, each with its efforts", async () => {
  const { codexCatalog } = await import('../hooks/crew.ts')
  const list = codexCatalog(codexList)
  expect(list.map((m) => m.slug)).toEqual(['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-luna'])
  expect(list[2]?.efforts).toEqual(['low', 'medium', 'high'])
  expect(codexCatalog(JSON.stringify({ models: JSON.parse(codexList) })).length).toBe(3)
  expect(codexCatalog('not json')).toEqual([])
})

test('"luna" is kept as the tier and runs on its newest model; a GPT-7 Luna is taken up by itself', async () => {
  const { codexCatalog, resolveCodexChoice, resolvedChoice, describeChoice } = await import('../hooks/crew.ts')
  const today = codexCatalog(codexList)
  expect(resolveCodexChoice('luna', 'high', today)).toMatchObject({ ok: true, choice: { model: 'luna', effort: 'high' } })
  expect(resolvedChoice('codex', { model: 'luna', effort: 'high' }, today)).toEqual({ model: 'gpt-5.6-luna', effort: 'high' })
  const later = codexCatalog(
    JSON.stringify([
      ...JSON.parse(codexList),
      { slug: 'gpt-7-luna', display_name: 'GPT-7-Luna', description: 'Newer', visibility: 'list', supported_reasoning_levels: [{ effort: 'high' }] },
      { slug: 'gpt-6.10-luna', display_name: 'GPT-6.10-Luna', description: 'Between', visibility: 'list', supported_reasoning_levels: [] },
    ]),
  )
  expect(resolvedChoice('codex', { model: 'luna' }, later)).toEqual({ model: 'gpt-7-luna' })
  expect(describeChoice({ model: 'luna', effort: 'high' }, today)).toBe('luna (newest, now gpt-5.6-luna) · effort high')
})

test('an exact id pins that model; an unknown name or an effort the model lacks is refused with what is there', async () => {
  const { codexCatalog, resolveCodexChoice, resolvedChoice } = await import('../hooks/crew.ts')
  const today = codexCatalog(codexList)
  expect(resolveCodexChoice('gpt-5.6-sol', undefined, today)).toMatchObject({ ok: true, choice: { model: 'gpt-5.6-sol' } })
  expect(resolveCodexChoice('GPT-6-Astra', 'ultra', today)).toMatchObject({ ok: true, choice: { model: 'gpt-6-astra', effort: 'ultra' } })
  expect(resolvedChoice('codex', { model: 'gpt-5.6-sol' }, today)).toEqual({ model: 'gpt-5.6-sol' })
  const unknown = resolveCodexChoice('nova', undefined, today)
  expect(unknown.ok).toBe(false)
  expect(!unknown.ok && unknown.suggestions.join('\n')).toContain('luna (now gpt-5.6-luna)')
  const effort = resolveCodexChoice('luna', 'ultra', today)
  expect(!effort.ok && effort.suggestions).toEqual(['low', 'medium', 'high'])
  // The effort alone keeps the model chosen before.
  expect(resolveCodexChoice('', 'low', today, { model: 'sol' })).toMatchObject({ ok: true, choice: { model: 'sol', effort: 'low' } })
})

test('OpenCode: the full id, or a model name only one provider has', async () => {
  const { resolveOpencodeChoice } = await import('../hooks/crew.ts')
  const models = ['fireworks/kimi-k3', 'openai/gpt-5.6-sol', 'github-copilot/gpt-5.6-sol']
  expect(resolveOpencodeChoice('kimi-k3', 'high', models)).toMatchObject({ ok: true, choice: { model: 'fireworks/kimi-k3', effort: 'high' } })
  expect(resolveOpencodeChoice('openai/gpt-5.6-sol', undefined, models)).toMatchObject({ ok: true, choice: { model: 'openai/gpt-5.6-sol' } })
  const two = resolveOpencodeChoice('gpt-5.6-sol', undefined, models)
  expect(!two.ok && two.why).toContain('more than one provider')
  expect(resolveOpencodeChoice('nope', undefined, models).ok).toBe(false)
})

test('the chosen model reaches the CLI as quoted flags, and a hostile value stays one quoted word', async () => {
  const { reviewerArgs, reviewerSpec, codexCatalog } = await import('../hooks/crew.ts')
  expect(reviewerArgs('codex', {})).toBe('set --')
  expect(reviewerArgs('codex', { model: 'gpt-5.6-luna', effort: 'high' })).toBe(`set -- -m 'gpt-5.6-luna' -c 'model_reasoning_effort="high"'`)
  expect(reviewerArgs('opencode', { model: 'fireworks/kimi-k3', effort: 'high' })).toBe(`set -- -m 'fireworks/kimi-k3' --variant 'high'`)
  // Run through a real shell: the value comes back as one argument, nothing executed.
  const hostile = "x'; echo pwned; '"
  // @ts-expect-error: Bun's own global (the typecheck here has no Bun types)
  const out = Bun.spawnSync(['bash', '-c', `${reviewerArgs('codex', { model: hostile })}; printf '%s|' "$@"`]).stdout.toString()
  expect(out).toBe(`-m|${hostile}|`)
  const prompt = reviewerSpec('codex', 'haiku', { model: 'gpt-5.6-luna' }, codexCatalog(codexList)).prompt
  expect(prompt).toContain("set -- -m 'gpt-5.6-luna'")
  expect(prompt).toContain("luna = -m 'gpt-5.6-luna'")
  expect(prompt).toContain("astra = -m 'gpt-6-astra'")
})

test('reviewer choices: set, kept in the record for every session, and back to the CLI default', () => {
  expect(parseCrewCommand('reviewer codex luna high')).toEqual({ kind: 'reviewer-paste', reviewer: 'codex', input: 'luna', effort: 'high' })
  expect(parseCrewCommand('reviewer codex effort xhigh')).toEqual({ kind: 'reviewer-paste', reviewer: 'codex', input: '', effort: 'xhigh' })
  expect(parseCrewCommand('reviewer opencode default')).toEqual({ kind: 'reviewer-choice', reviewer: 'opencode', choice: {} })
  let overrides = applyCrewCommand({}, { kind: 'reviewer-choice', reviewer: 'codex', choice: { model: 'luna', effort: 'high' } })
  expect(JSON.parse(routerTable(crewOf({}, overrides), overrides)).reviewers).toEqual({ codex: { model: 'luna', effort: 'high' } })
  expect(crewOf({}, overridesOf({ reviewerChoices: { codex: { model: 'luna; rm', effort: 'high' } } })).reviewerChoices).toEqual({ codex: { effort: 'high' } })
  overrides = applyCrewCommand(overrides, { kind: 'reviewer-choice', reviewer: 'codex', choice: {} })
  expect(overrides.reviewerChoices).toEqual({})
})
