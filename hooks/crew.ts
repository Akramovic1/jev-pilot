/**
 * jev-pilot — the crew: which workers a session can use and how the user wants
 * them used. Pure: the hooks read options and the store, and act on this.
 *
 * Workers:
 *   Claude       haiku, sonnet, opus (the plan's own models)
 *   model slots  alpha, beta, gamma: any OpenRouter model, reached through the
 *                local router (router/jev-router.mjs) as `jev-<slot>`
 *   agents       Codex and OpenCode, their own CLIs, as reviewers
 *
 * Modes (the user's choice, `/jev mode <name>`); Jev decides within one:
 *   standard        Claude only (the default)
 *   budget          model slots take subagent work that needs no judgment
 *   junior-lead     a junior on a slot writes easy, well-specified code;
 *                   the main conversation reviews it as the tech lead
 *   second-opinion  an external agent reviews significant changes
 *   quality         Opus for every subagent, and an external review
 */

export type Mode = 'standard' | 'budget' | 'junior-lead' | 'second-opinion' | 'quality'
export const MODES: readonly Mode[] = ['standard', 'budget', 'junior-lead', 'second-opinion', 'quality']

export const MODE_INFO: Record<Mode, string> = {
  standard: 'Claude only: Jev picks Haiku, Sonnet or Opus and the effort for each task',
  budget: 'custom models take subagent work that needs no judgment; Opus keeps the judgment',
  'junior-lead': 'a junior on a custom model writes easy, well-specified code; Opus reviews it as tech lead',
  'second-opinion': 'an external agent (Codex or OpenCode) reviews significant changes before they are done',
  quality: 'Opus for every subagent, and an external review of significant changes',
}

export type Reviewer = 'codex' | 'opencode'
export const REVIEWERS: readonly Reviewer[] = ['codex', 'opencode']

export interface Slot {
  name: string
  /** The OpenRouter model id, e.g. deepseek/deepseek-v4.1-flash. */
  model: string
  /** When to choose it: what the decision model reads. */
  when: string
}

export const SLOT_NAMES = ['alpha', 'beta', 'gamma'] as const
export type SlotName = (typeof SLOT_NAMES)[number]

export const DEFAULT_SLOT_WHEN =
  'Choose for bulk work with nothing to judge, where cost matters more than precision: searching or reading across many files and reporting what is there, summarizing, listing, filling in boilerplate from an existing pattern.'

/**
 * No slot has a model until you give it one: `/jev alpha <model>`, pasting
 * the model's id, page link or name from openrouter.ai/models. What you set
 * is kept in the plugin's store, so every session uses it.
 */
export const DEFAULT_SLOTS: Record<SlotName, { model: string; when: string }> = {
  alpha: { model: '', when: DEFAULT_SLOT_WHEN },
  beta: { model: '', when: DEFAULT_SLOT_WHEN },
  gamma: { model: '', when: DEFAULT_SLOT_WHEN },
}

/** The model name Claude Code uses for a slot; the router maps it to the slot's model. */
export function slotAlias(name: string): string {
  return `jev-${name}`
}

/** What `/jev` has changed, kept in the store. */
export interface CrewOverrides {
  mode?: Mode
  /** A slot's model, or '' to turn it off. */
  models?: Partial<Record<SlotName, string>>
  junior?: SlotName
  reviewer?: Reviewer
  /** The models set before, newest first, so switching back is one command. */
  recent?: string[]
}

/** How many models `/jev <slot>` remembers. */
export const RECENT_MODELS = 5

export interface Crew {
  mode: Mode
  /** The slots with a model, in order. */
  slots: Slot[]
  junior: SlotName
  reviewer: Reviewer
}

/** The crew from the options (defaults) and what `/jev` changed. */
export function crewOf(options: Record<string, unknown>, overrides: CrewOverrides = {}): Crew {
  const text = (key: string, fallback: string) => (typeof options[key] === 'string' ? (options[key] as string).trim() : fallback)
  const slots: Slot[] = []
  for (const name of SLOT_NAMES) {
    const model = overrides.models?.[name] ?? text(`${name}Model`, DEFAULT_SLOTS[name].model)
    if (model) slots.push({ name, model, when: text(`${name}When`, DEFAULT_SLOTS[name].when) || DEFAULT_SLOT_WHEN })
  }
  const modeOption = text('mode', 'standard') as Mode
  const juniorOption = text('junior', 'alpha') as SlotName
  const reviewerOption = text('reviewer', 'codex') as Reviewer
  return {
    mode: overrides.mode ?? (MODES.includes(modeOption) ? modeOption : 'standard'),
    slots,
    junior: overrides.junior ?? (SLOT_NAMES.includes(juniorOption) ? juniorOption : 'alpha'),
    reviewer: overrides.reviewer ?? (REVIEWERS.includes(reviewerOption) ? reviewerOption : 'codex'),
  }
}

/** Overrides read back from the store; anything that isn't one is dropped. */
export function overridesOf(stored: unknown): CrewOverrides {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}
  const raw = stored as Record<string, unknown>
  const out: CrewOverrides = {}
  if (typeof raw.mode === 'string' && MODES.includes(raw.mode as Mode)) out.mode = raw.mode as Mode
  if (typeof raw.junior === 'string' && SLOT_NAMES.includes(raw.junior as SlotName)) out.junior = raw.junior as SlotName
  if (typeof raw.reviewer === 'string' && REVIEWERS.includes(raw.reviewer as Reviewer)) out.reviewer = raw.reviewer as Reviewer
  if (Array.isArray(raw.recent)) {
    out.recent = raw.recent.filter((id): id is string => typeof id === 'string' && MODEL_ID.test(id)).slice(0, RECENT_MODELS)
  }
  if (raw.models && typeof raw.models === 'object' && !Array.isArray(raw.models)) {
    const models: Partial<Record<SlotName, string>> = {}
    for (const name of SLOT_NAMES) {
      const value = (raw.models as Record<string, unknown>)[name]
      if (typeof value === 'string') models[name] = value.trim()
    }
    out.models = models
  }
  return out
}

/**
 * ~/.claude/jev-pilot/models.json: the router's table, and the record of
 * what you set. Every slot is written, an unset one as "", with the models
 * set before, so every session (any project, any install of jev-pilot)
 * reads the same choice back.
 */
export function routerTable(crew: Crew, recent: readonly string[] = []): string {
  const slots = Object.fromEntries(SLOT_NAMES.map((name) => [name, { model: crew.slots.find((slot) => slot.name === name)?.model ?? '' }]))
  return JSON.stringify({ slots, recent: recent.slice(0, RECENT_MODELS) }, null, 2)
}

/**
 * The slot models and recent models recorded in models.json, as overrides;
 * null when the file isn't one (missing, or not jev-pilot's).
 */
export function recordedModels(fileText: string | null): Pick<CrewOverrides, 'models' | 'recent'> | null {
  if (!fileText) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(fileText)
  } catch {
    return null
  }
  const slots = (parsed as { slots?: unknown })?.slots
  if (!slots || typeof slots !== 'object' || Array.isArray(slots)) return null
  const models: Partial<Record<SlotName, string>> = {}
  for (const name of SLOT_NAMES) {
    const model = (slots as Record<string, { model?: unknown } | undefined>)[name]?.model
    if (typeof model === 'string' && (model === '' || MODEL_ID.test(model))) models[name] = model
  }
  const recent = overridesOf({ recent: (parsed as { recent?: unknown }).recent }).recent
  return { models, ...(recent ? { recent } : {}) }
}

/**
 * The slots Jev may choose for a subagent. Only with the router running, and
 * only in the modes that hand work to custom models.
 */
export function slotsOffered(crew: Crew, routerOn: boolean): Slot[] {
  if (!routerOn) return []
  return crew.mode === 'budget' || crew.mode === 'junior-lead' ? crew.slots : []
}

/** The junior's slot, when the junior can work: junior-lead mode, the router up, the slot set. */
export function juniorSlot(crew: Crew, routerOn: boolean): Slot | null {
  if (!routerOn || crew.mode !== 'junior-lead') return null
  return crew.slots.find((slot) => slot.name === crew.junior) ?? null
}

/** Whether significant changes get an external review. */
export function reviews(crew: Crew): boolean {
  return crew.mode === 'second-opinion' || crew.mode === 'quality'
}

export type CrewCommand =
  | { kind: 'show' }
  | { kind: 'mode'; mode: Mode }
  /** `model` is the resolved id ('' turns the slot off). */
  | { kind: 'model'; slot: SlotName; model: string }
  /** `/jev alpha <what you pasted>`: resolved against OpenRouter's list before it's set. */
  | { kind: 'paste'; slot: SlotName; input: string }
  /** `/jev alpha`: the slot, its model, and the ones set before. */
  | { kind: 'slot'; slot: SlotName }
  | { kind: 'junior'; slot: SlotName }
  | { kind: 'reviewer'; reviewer: Reviewer }
  | { kind: 'unknown'; text: string }

/**
 * `/jev` arguments about the crew, or null when they're about something else:
 *   models                      the crew: mode, slots, junior, reviewer
 *   mode <name>                 standard · budget · junior-lead · second-opinion · quality
 *   alpha                       the slot: its model, and the ones set before
 *   alpha <openrouter model>    a slot's model (beta, gamma likewise), pasted as its id,
 *                               page link or name; `off` clears it
 *   junior <slot>               which slot the junior runs on
 *   reviewer <codex|opencode>   which external agent reviews
 */
export function parseCrewCommand(args: string): CrewCommand | null {
  const words = args.trim().split(/\s+/).filter(Boolean)
  const head = words[0]?.toLowerCase()
  if (head === 'models' || head === 'crew') return { kind: 'show' }
  if (head === 'mode') {
    const mode = words[1]?.toLowerCase() as Mode | undefined
    return mode && MODES.includes(mode) ? { kind: 'mode', mode } : { kind: 'unknown', text: `mode ${words[1] ?? ''}`.trim() }
  }
  if (head && SLOT_NAMES.includes(head as SlotName)) {
    const slot = head as SlotName
    const input = args.trim().slice(head.length).trim()
    if (!input) return { kind: 'slot', slot }
    if (input.toLowerCase() === 'off') return { kind: 'model', slot, model: '' }
    return { kind: 'paste', slot, input }
  }
  if (head === 'junior') {
    const slot = words[1]?.toLowerCase() as SlotName | undefined
    return slot && SLOT_NAMES.includes(slot) ? { kind: 'junior', slot } : { kind: 'unknown', text: args.trim() }
  }
  if (head === 'reviewer') {
    const reviewer = words[1]?.toLowerCase() as Reviewer | undefined
    return reviewer && REVIEWERS.includes(reviewer) ? { kind: 'reviewer', reviewer } : { kind: 'unknown', text: args.trim() }
  }
  return null
}

/** Applies a command to the overrides. */
export function applyCrewCommand(overrides: CrewOverrides, command: CrewCommand): CrewOverrides {
  if (command.kind === 'mode') return { ...overrides, mode: command.mode }
  if (command.kind === 'model') {
    const recent = command.model ? [command.model, ...(overrides.recent ?? []).filter((id) => id !== command.model)].slice(0, RECENT_MODELS) : overrides.recent
    return { ...overrides, models: { ...(overrides.models ?? {}), [command.slot]: command.model }, ...(recent ? { recent } : {}) }
  }
  if (command.kind === 'junior') return { ...overrides, junior: command.slot }
  if (command.kind === 'reviewer') return { ...overrides, reviewer: command.reviewer }
  return overrides
}

/** `/jev models`: the crew as it stands. */
export function describeCrew(crew: Crew, routerOn: boolean): string {
  const lines = [
    `jev-pilot mode: ${crew.mode} (${MODE_INFO[crew.mode]})`,
    `  /jev mode <${MODES.join('|')}>`,
    `custom models (${routerOn ? 'router running' : 'router not running: start Claude Code with claude-jev'}):`,
  ]
  for (const name of SLOT_NAMES) {
    const slot = crew.slots.find((s) => s.name === name)
    lines.push(`  ${name.padEnd(6)} ${slot ? slot.model : 'not set'}${name === crew.junior ? '   (the junior)' : ''}`)
  }
  lines.push(`  /jev <alpha|beta|gamma> <model pasted from openrouter.ai/models>|off · /jev junior <slot>`)
  lines.push(`reviewer: ${crew.reviewer}   /jev reviewer <codex|opencode>`)
  return lines.join('\n')
}

// ---- the junior: a coder on a custom model, reviewed by the lead ----------------

/** An agent type jev-pilot registers, as `$.agent.register` takes it. */
export interface AgentSpec {
  name: string
  description: string
  prompt: string
  tools: string[]
  model: string
  maxTurns: number
}

export const JUNIOR_AGENT = 'jev-pilot:junior'

/** The junior's agent definition, registered as `jev-pilot:junior`. */
export function juniorSpec(model: string): AgentSpec {
  return {
    name: 'junior',
    description:
      'A junior developer on a cheaper model. Give it one easy, well-specified coding change: the files to change, the exact behavior, and the command that proves it (usually the tests). It implements and reports; review its diff yourself before calling the work done.',
    prompt: [
      'You are the junior developer on a small team. Your lead gives you one well-specified coding task.',
      'Do exactly that: change only what the brief names, follow the existing code style, and run the command the brief gives to prove it (usually the tests).',
      "Don't refactor, rename or add anything that wasn't asked for.",
      "If the brief is unclear, or the task turns out bigger than it says, stop and say so instead of guessing.",
      'When you are done, reply with: what you changed (file by file, one line each), the command you ran and its result, and anything you were unsure about.',
    ].join('\n'),
    tools: ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash'],
    model,
    maxTurns: 40,
  }
}

// ---- the reviewers: Codex and OpenCode, their own CLI agents --------------------

export function reviewerAgent(reviewer: Reviewer): string {
  return `jev-pilot:${reviewer}-review`
}

const REVIEWER_NAME: Record<Reviewer, string> = { codex: 'Codex', opencode: 'OpenCode' }

/** What the external agent is asked, ahead of the lead's brief. */
export const REVIEW_INSTRUCTIONS = [
  "Review a code change in this repository, read-only: don't edit anything.",
  'Read the changed files and `git diff` (or `git diff HEAD~1` when the change is already committed).',
  'Check that it does what the brief says, and look for wrong behavior, input that is not checked, broken edge cases and missing tests.',
  'Report each finding as P1 (wrong behavior or lost data), P2 (a likely bug or a missing check) or P3 (minor), with file:line and a one-line fix.',
  'End with one verdict: PASS, PASS-WITH-FOLLOWUP or NEEDS FIXES. Keep it tight.',
].join('\n')

/** The command that runs the review, reading the brief from `$brief`. */
function reviewCommand(reviewer: Reviewer): string {
  return reviewer === 'codex'
    ? 'codex exec -s read-only --skip-git-repo-check -C "$PWD" -o "$brief.out" - < "$brief" > /dev/null 2> "$brief.err"; echo "exit $?"; cat "$brief.out" 2>/dev/null || tail -20 "$brief.err"'
    : 'opencode run --agent plan --dir "$PWD" "$(cat "$brief")" < /dev/null 2> "$brief.err"; echo "exit $?"; [ -s "$brief.err" ] && tail -5 "$brief.err"'
}

/**
 * A reviewer's agent definition, registered as `jev-pilot:<reviewer>-review`:
 * a small Claude model that hands the brief to the external CLI and brings
 * its findings back, so the long review stays out of the main conversation.
 */
export function reviewerSpec(reviewer: Reviewer, model: string): AgentSpec {
  const name = REVIEWER_NAME[reviewer]
  return {
    name: `${reviewer}-review`,
    description: `Gets a code review from ${name}, an external coding agent (its own CLI, not Claude). Brief it with what changed and why, the files, and what to check; it returns ${name}'s findings (P1/P2/P3) and verdict. Takes a few minutes: run it in the background when there is other work.`,
    prompt: [
      `You hand a code review to ${name}, an external coding agent, and bring back what it finds. You don't review the code yourself.`,
      'Run one Bash command (timeout 600000), with the brief you were given pasted between the JEV_BRIEF lines exactly as given:',
      '',
      'brief=$(mktemp /tmp/jev-review-XXXXXX); cat > "$brief" <<\'JEV_BRIEF\'',
      REVIEW_INSTRUCTIONS,
      '',
      'The change:',
      '<the brief>',
      'JEV_BRIEF',
      reviewCommand(reviewer),
      '',
      `Then reply with ${name}'s findings and verdict as it gave them, without adding your own.`,
      `If the command fails or times out, reply with the exit code and the error lines instead, and say the review didn't run. Don't retry more than once.`,
    ].join('\n'),
    tools: ['Bash'],
    model,
    maxTurns: 6,
  }
}

/**
 * The crew's lines for the note to the main model: the mode the user chose,
 * the junior, and the reviewers that are working.
 */
export function crewNote(crew: Crew, junior: Slot | null, working: Reviewer[]): string[] {
  const lines: string[] = []
  if (crew.mode !== 'standard') lines.push(`The user chose the ${crew.mode} mode: ${MODE_INFO[crew.mode]}.`)
  if (junior) {
    lines.push(
      `${JUNIOR_AGENT} is a junior developer on ${junior.model}. Give it easy, well-specified coding changes (the files, the exact behavior, the command that proves it); then read its diff and run the tests yourself before calling the work done, and send it back once with your findings if it needs fixing.`,
    )
  }
  if (working.length > 0) {
    lines.push(
      `External reviewers (their own CLI agents, not Claude): ${working.map((r) => `${reviewerAgent(r)} (${REVIEWER_NAME[r]})`).join(', ')}. Use one when the user asks for a review by it.`,
    )
  }
  if (reviews(crew)) {
    const chosen = working.includes(crew.reviewer) ? crew.reviewer : (working[0] ?? null)
    lines.push(
      chosen
        ? `After a significant change (a new feature, an edit across several files, anything touching security, money or stored data), before calling it done, spawn ${reviewerAgent(chosen)} with a brief: what changed and why, the files, what to check. Weigh its findings: fix what is right, and say why you disagree with the rest.`
        : `No external reviewer is working (${REVIEWER_NAME[crew.reviewer]} failed its check; /jev status shows why), so there is no external review: say so once when one would have been due.`,
    )
  }
  return lines
}

// ---- setting a slot: what you paste from OpenRouter, checked against its list -----

/** An OpenRouter model id: provider/model, optionally with a :variant or a ~ alias. */
export const MODEL_ID = /^~?[\w.-]+\/[\w.:-]+$/

/** Where to find a model to paste: OpenRouter's list, filtered to models that can call tools. */
export const MODELS_PAGE = 'https://openrouter.ai/models?supported_parameters=tools'

/** A model as OpenRouter's list (GET /api/v1/models) describes it. */
export interface OpenRouterModel {
  id: string
  name?: string
  canonical_slug?: string
  context_length?: number
  /** When OpenRouter added it, seconds since the epoch: the newest are suggested first. */
  created?: number
  pricing?: { prompt?: string; completion?: string }
  supported_parameters?: string[]
}

export type Resolved =
  | { ok: true; id: string; about: string }
  | { ok: false; why: string; suggestions: string[] }

const clean = (text: string) => text.trim().replace(/^[`'"<]+|[`'">]+$/g, '').trim()

/** Per million tokens, as OpenRouter shows it: "$0.14 in · $0.42 out". */
function price(model: OpenRouterModel): string {
  const perMillion = (value: string | undefined) => {
    const n = Number(value)
    return Number.isFinite(n) ? `$${(n * 1e6).toFixed(n * 1e6 < 1 ? 3 : 2).replace(/0+$/, '').replace(/\.$/, '')}` : '?'
  }
  return `${perMillion(model.pricing?.prompt)} in · ${perMillion(model.pricing?.completion)} out per million tokens`
}

/** "DeepSeek: DeepSeek V4.1 Flash · 1M context · $0.14 in · $0.42 out per million tokens" */
export function aboutModel(model: OpenRouterModel): string {
  const context = model.context_length
    ? ` · ${model.context_length >= 1e6 ? `${Math.round(model.context_length / 1e5) / 10}M` : `${Math.round(model.context_length / 1000)}k`} context`
    : ''
  return `${model.name ?? model.id}${context} · ${price(model)}`
}

/**
 * What was pasted, as a model OpenRouter serves and a subagent can use.
 * Accepted: the id (`deepseek/deepseek-v4.1-flash`), its page link
 * (`https://openrouter.ai/deepseek/deepseek-v4.1-flash`), its dated slug, or
 * its name as the list shows it (`DeepSeek: DeepSeek V4.1 Flash`, or without
 * the `DeepSeek: ` prefix). Refused: anything not in the list (with the
 * closest ids to try), and models that can't call tools: a subagent works
 * through tools, so one without them could do nothing.
 *
 * With no list (OpenRouter unreachable), an id-shaped paste is taken as is;
 * the slot's own check (a 1-token request) then says whether it answers.
 */
export function resolveModel(pasted: string, catalog: readonly OpenRouterModel[] | null): Resolved {
  let text = clean(pasted)
  const link = /^(?:https?:\/\/)?(?:www\.)?openrouter\.ai\/(?:models\/)?([^?#\s]+)/i.exec(text)
  if (link) text = (link[1] as string).split('/').slice(0, 2).join('/')
  if (!text) return { ok: false, why: 'nothing pasted', suggestions: [] }
  if (!catalog) {
    return MODEL_ID.test(text)
      ? { ok: true, id: text, about: `${text} (OpenRouter's list couldn't be read to check it)` }
      : { ok: false, why: `"${text}" isn't a model id (provider/model), and OpenRouter's list couldn't be read to look it up`, suggestions: [] }
  }
  const lower = text.toLowerCase()
  const bare = (name: string | undefined) => (name ?? '').toLowerCase().replace(/^[^:]+:\s*/, '')
  const found =
    catalog.find((m) => m.id.toLowerCase() === lower) ??
    catalog.find((m) => (m.canonical_slug ?? '').toLowerCase() === lower) ??
    catalog.find((m) => (m.name ?? '').toLowerCase() === lower) ??
    catalog.find((m) => bare(m.name) === lower.replace(/^[^:]+:\s*/, ''))
  if (!found) {
    const words = lower.split(/[^a-z0-9.]+/).filter((w) => w.length > 1)
    const score = (m: OpenRouterModel) => words.filter((w) => `${m.id} ${m.name ?? ''}`.toLowerCase().includes(w)).length
    const suggestions = catalog
      .filter((m) => (m.supported_parameters ?? []).includes('tools') && score(m) > 0)
      .sort((a, b) => score(b) - score(a) || (b.created ?? 0) - (a.created ?? 0) || a.id.length - b.id.length)
      .slice(0, 3)
      .map((m) => m.id)
    return { ok: false, why: `OpenRouter has no model "${text}"`, suggestions }
  }
  if (!(found.supported_parameters ?? []).includes('tools')) {
    return { ok: false, why: `${found.id} can't call tools on OpenRouter, so it can't work as a subagent`, suggestions: [] }
  }
  return { ok: true, id: found.id, about: aboutModel(found) }
}

/** `/jev alpha`: the slot, its model, and the models set before (to switch back). */
export function describeSlot(crew: Crew, name: SlotName, recent: readonly string[] = []): string {
  const slot = crew.slots.find((s) => s.name === name)
  const lines = [
    slot ? `${name}: ${slot.model}${name === crew.junior ? ' (the junior)' : ''}` : `${name}: not set`,
    `  set it: /jev ${name} <model>, pasting its id, page link or name from ${MODELS_PAGE}`,
  ]
  if (slot) lines.push(`  turn it off: /jev ${name} off`)
  const others = recent.filter((id) => id !== slot?.model)
  if (others.length > 0) lines.push('  set before:', ...others.map((id) => `    /jev ${name} ${id}`))
  return lines.join('\n')
}
