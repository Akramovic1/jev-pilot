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

import { FEATURES } from './features.ts'

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
  /** Its name, as you type it after /jev: `flash` in `/jev flash deepseek/...`. */
  name: string
  /** The OpenRouter model id, e.g. deepseek/deepseek-v4.1-flash. */
  model: string
  /** When to choose it: what the decision model reads. */
  when: string
  /** What OpenRouter says it is, when known: "DeepSeek: DeepSeek V4.1 Flash · 1M context · $0.14 in · …". */
  about?: string
}

/**
 * A custom model's name, as you type it after `/jev`: lowercase letters,
 * digits and "-", starting with a letter. Claude Code sees it as `jev-<name>`.
 */
export const SLOT_NAME = /^[a-z][a-z0-9-]{0,23}$/

/** Words `/jev` already means something by: never a custom model's name. */
export const RESERVED_NAMES: ReadonlySet<string> = new Set([
  ...FEATURES,
  'all', 'reset', 'status', 'mode', 'models', 'crew', 'junior', 'reviewer', 'tune',
  'remove', 'delete', 'on', 'off', 'help', 'list', 'default', 'set', 'when',
])

/** A name `/jev <name> <model>` may use. */
export function validName(name: string): boolean {
  return SLOT_NAME.test(name) && !RESERVED_NAMES.has(name)
}

/** At most this many custom models at once: each is an option in Jev's question. */
export const MAX_MODELS = 8

/** How many entries a record (the store, models.json) is read for, removed ones included. */
export const RECORD_LIMIT = 64

/** The names the `alphaModel`/`betaModel`/`gammaModel` settings fill (before names were yours to choose). */
export const LEGACY_NAMES = ['alpha', 'beta', 'gamma'] as const

export const DEFAULT_SLOT_WHEN =
  'Choose for bulk work with nothing to judge, where cost matters more than precision: searching or reading across many files and reporting what is there, summarizing, listing, filling in boilerplate from an existing pattern.'

/** The model name Claude Code uses for a slot; the router maps it to the slot's model. */
export function slotAlias(name: string): string {
  return `jev-${name}`
}

/** What `/jev` has changed. */
export interface CrewOverrides {
  mode?: Mode
  /** Each custom model by its name; '' once removed (so a setting can't bring it back). */
  models?: Record<string, string>
  junior?: string
  reviewer?: Reviewer
  /** The models set before, newest first, so switching back is one command. */
  recent?: string[]
  /** What OpenRouter said each model is, by id. */
  about?: Record<string, string>
  /** The model and effort each reviewer runs with, when not its CLI's own default. */
  reviewerChoices?: Partial<Record<Reviewer, ReviewerChoice>>
}

/** A reviewer's model and effort; either may be left to the CLI's own config. */
export interface ReviewerChoice {
  model?: string
  effort?: string
}

/** How many models `/jev <name>` remembers. */
export const RECENT_MODELS = 5

export interface Crew {
  mode: Mode
  /** The custom models set, in the order they were added. */
  slots: Slot[]
  /** The junior's model name ('' when there is none). */
  junior: string
  reviewer: Reviewer
  reviewerChoices: Partial<Record<Reviewer, ReviewerChoice>>
}

/** The crew from the options and what `/jev` changed. */
export function crewOf(options: Record<string, unknown>, overrides: CrewOverrides = {}): Crew {
  const text = (key: string, fallback: string) => (typeof options[key] === 'string' ? (options[key] as string).trim() : fallback)
  const models: Record<string, string> = { ...(overrides.models ?? {}) }
  for (const name of LEGACY_NAMES) if (!(name in models)) models[name] = text(`${name}Model`, '')
  const slots: Slot[] = []
  for (const [name, model] of Object.entries(models)) {
    // A record written elsewhere with more than the limit: the first ones count.
    if (slots.length >= MAX_MODELS) break
    if (!model || !validName(name)) continue
    const about = overrides.about?.[model]
    slots.push({ name, model, when: text(`${name}When`, '') || DEFAULT_SLOT_WHEN, ...(about ? { about } : {}) })
  }
  const modeOption = text('mode', 'standard') as Mode
  const reviewerOption = text('reviewer', 'codex') as Reviewer
  const juniorWanted = overrides.junior ?? text('junior', '')
  return {
    mode: overrides.mode ?? (MODES.includes(modeOption) ? modeOption : 'standard'),
    slots,
    // The one named, while it's set; else the first model.
    junior: slots.some((slot) => slot.name === juniorWanted) ? juniorWanted : (slots[0]?.name ?? ''),
    reviewer: overrides.reviewer ?? (REVIEWERS.includes(reviewerOption) ? reviewerOption : 'codex'),
    reviewerChoices: { ...(overrides.reviewerChoices ?? {}) },
  }
}

/** A reviewer model id as the CLIs name them (checked against their lists when set). */
const REVIEWER_MODEL_ID = /^[\w.:~-]+(?:\/[\w.:~-]+)?$/
/** A reasoning effort word (the CLIs' own names: low, medium, high, xhigh, max, ultra…). */
const EFFORT_WORD = /^[a-z]{2,12}$/

/** A reviewer choice read back from a record; anything that isn't one is dropped. */
function reviewerChoicesOf(raw: unknown): Partial<Record<Reviewer, ReviewerChoice>> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Partial<Record<Reviewer, ReviewerChoice>> = {}
  for (const reviewer of REVIEWERS) {
    const entry = (raw as Record<string, unknown>)[reviewer]
    if (!entry || typeof entry !== 'object') continue
    const { model, effort } = entry as { model?: unknown; effort?: unknown }
    const choice: ReviewerChoice = {}
    if (typeof model === 'string' && model.length <= 100 && REVIEWER_MODEL_ID.test(model)) choice.model = model
    if (typeof effort === 'string' && EFFORT_WORD.test(effort)) choice.effort = effort
    if (choice.model || choice.effort) out[reviewer] = choice
  }
  return out
}

/** Overrides read back from the store or models.json; anything that isn't one is dropped. */
export function overridesOf(stored: unknown): CrewOverrides {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}
  const raw = stored as Record<string, unknown>
  const out: CrewOverrides = {}
  if (typeof raw.mode === 'string' && MODES.includes(raw.mode as Mode)) out.mode = raw.mode as Mode
  if (typeof raw.junior === 'string' && validName(raw.junior)) out.junior = raw.junior
  if (typeof raw.reviewer === 'string' && REVIEWERS.includes(raw.reviewer as Reviewer)) out.reviewer = raw.reviewer as Reviewer
  if (Array.isArray(raw.recent)) {
    out.recent = raw.recent.filter((id): id is string => typeof id === 'string' && MODEL_ID.test(id)).slice(0, RECENT_MODELS)
  }
  if (raw.models && typeof raw.models === 'object' && !Array.isArray(raw.models)) {
    const models: Record<string, string> = {}
    for (const [name, value] of Object.entries(raw.models as Record<string, unknown>).slice(0, RECORD_LIMIT)) {
      if (validName(name) && typeof value === 'string' && (value.trim() === '' || MODEL_ID.test(value.trim()))) models[name] = value.trim()
    }
    out.models = models
  }
  const choices = reviewerChoicesOf(raw.reviewerChoices)
  if (choices) out.reviewerChoices = choices
  if (raw.about && typeof raw.about === 'object' && !Array.isArray(raw.about)) {
    const about: Record<string, string> = {}
    for (const [id, value] of Object.entries(raw.about as Record<string, unknown>).slice(0, RECORD_LIMIT)) {
      if (MODEL_ID.test(id) && typeof value === 'string') about[id] = value.slice(0, 200)
    }
    out.about = about
  }
  return out
}

/**
 * ~/.claude/jev-pilot/models.json: the router's table, and the record of
 * what you set: every model by its name (a removed one as ""), what
 * OpenRouter said it is, and the models set before. Every session, in any
 * project and whichever way jev-pilot is installed, reads the same choice back.
 */
export function routerTable(crew: Crew, overrides: Pick<CrewOverrides, 'models' | 'recent' | 'reviewerChoices'> = {}): string {
  const slots: Record<string, { model: string; about?: string }> = {}
  for (const [name, model] of Object.entries(overrides.models ?? {})) if (model === '' && validName(name)) slots[name] = { model: '' }
  for (const slot of crew.slots) slots[slot.name] = { model: slot.model, ...(slot.about ? { about: slot.about } : {}) }
  const reviewers = overrides.reviewerChoices ?? {}
  return JSON.stringify({ slots, recent: (overrides.recent ?? []).slice(0, RECENT_MODELS), ...(Object.keys(reviewers).length > 0 ? { reviewers } : {}) }, null, 2)
}

/**
 * The models recorded in models.json, as overrides; null when the file
 * isn't one (missing, or not jev-pilot's).
 */
export function recordedModels(fileText: string | null): Pick<CrewOverrides, 'models' | 'recent' | 'about' | 'reviewerChoices'> | null {
  if (!fileText) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(fileText)
  } catch {
    return null
  }
  const slots = (parsed as { slots?: unknown })?.slots
  if (!slots || typeof slots !== 'object' || Array.isArray(slots)) return null
  const models: Record<string, string> = {}
  const about: Record<string, string> = {}
  for (const [name, entry] of Object.entries(slots as Record<string, { model?: unknown; about?: unknown } | undefined>).slice(0, RECORD_LIMIT)) {
    const model = entry?.model
    if (!validName(name) || typeof model !== 'string' || !(model === '' || MODEL_ID.test(model))) continue
    models[name] = model
    if (model && typeof entry?.about === 'string') about[model] = entry.about.slice(0, 200)
  }
  const recent = overridesOf({ recent: (parsed as { recent?: unknown }).recent }).recent
  const reviewerChoices = reviewerChoicesOf((parsed as { reviewers?: unknown }).reviewers) ?? {}
  return { models, ...(recent ? { recent } : {}), ...(Object.keys(about).length > 0 ? { about } : {}), reviewerChoices }
}

/**
 * The rows jev-pilot adds to Claude Code's `/model` list, one per custom
 * model (the `modelPicker` setting, in a file `claude-jev` passes with
 * `--settings`, so they're there only where the router is). `behavesAs`
 * lets Claude Code, which doesn't know the model, treat it like Sonnet on
 * its side (prompt, capabilities, effort); the requests still go to the
 * model itself.
 */
export function pickerSettings(crew: Crew): string {
  const options = crew.slots.map((slot) => {
    const [name, ...details] = (slot.about ?? '').split(' · ')
    return {
      model: slotAlias(slot.name),
      label: `${slot.name}${name ? ` · ${name.replace(/^[^:]+:\s*/, '')}` : ''}`,
      description: [`${slot.model} on OpenRouter`, ...details.filter((d) => !/context$/.test(d))].join(' · ') + ' · claude-jev only',
      behavesAs: 'sonnet',
    }
  })
  return JSON.stringify({ modelPicker: { options } }, null, 2)
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
  /** `model` is the resolved id ('' removes the model); `about` what OpenRouter says it is. */
  | { kind: 'model'; slot: string; model: string; about?: string }
  /** `/jev <name> <what you pasted>`: resolved against OpenRouter's list before it's set. */
  | { kind: 'paste'; slot: string; input: string }
  /** `/jev <name>`: that model, and the ones set before. */
  | { kind: 'slot'; slot: string }
  | { kind: 'junior'; slot: string }
  | { kind: 'reviewer'; reviewer: Reviewer }
  /** `/jev reviewer codex luna high`: resolved against the CLI's own model list before it's set. */
  | { kind: 'reviewer-paste'; reviewer: Reviewer; input: string; effort?: string }
  /** A reviewer's choice as set (after resolving); an empty choice goes back to the CLI's config. */
  | { kind: 'reviewer-choice'; reviewer: Reviewer; choice: ReviewerChoice }
  | { kind: 'unknown'; text: string }

/**
 * `/jev` arguments about the crew, or null when they're about something else
 * (a switch such as `/jev skills off`):
 *   models                      the crew: mode, custom models, junior, reviewer
 *   mode <name>                 standard · budget · junior-lead · second-opinion · quality
 *   <name> <openrouter model>   add a custom model under a name you choose, pasted as its
 *                               id, page link or name; the same name again replaces it
 *   <name>                      that model, and the ones set before
 *   remove <name>               delete it (also: <name> off)
 *   junior <name>               which custom model the junior runs on
 *   reviewer <codex|opencode>   which external agent reviews
 */
export function parseCrewCommand(args: string): CrewCommand | null {
  const words = args.trim().split(/\s+/).filter(Boolean)
  const head = words[0]?.toLowerCase()
  if (!head) return null
  if (head === 'models' || head === 'crew') return words.length === 1 ? { kind: 'show' } : { kind: 'unknown', text: args.trim() }
  if (head === 'mode') {
    const mode = words[1]?.toLowerCase() as Mode | undefined
    return mode && MODES.includes(mode) && words.length === 2 ? { kind: 'mode', mode } : { kind: 'unknown', text: args.trim() }
  }
  if (head === 'remove' || head === 'delete') {
    const name = words[1]?.toLowerCase()
    return name && validName(name) && words.length === 2 ? { kind: 'model', slot: name, model: '' } : { kind: 'unknown', text: args.trim() }
  }
  if (head === 'junior') {
    const name = words[1]?.toLowerCase()
    return name && validName(name) && words.length === 2 ? { kind: 'junior', slot: name } : { kind: 'unknown', text: args.trim() }
  }
  if (head === 'reviewer') {
    const reviewer = words[1]?.toLowerCase() as Reviewer | undefined
    if (!reviewer || !REVIEWERS.includes(reviewer)) return { kind: 'unknown', text: args.trim() }
    if (words.length === 2) return { kind: 'reviewer', reviewer }
    const third = (words[2] as string).toLowerCase()
    //   reviewer codex default          back to the CLI's own model and effort
    //   reviewer codex effort high      the effort alone
    //   reviewer codex luna [high]      a model, and an effort
    if (third === 'default' && words.length === 3) return { kind: 'reviewer-choice', reviewer, choice: {} }
    if (third === 'effort' && words.length === 4 && EFFORT_WORD.test((words[3] as string).toLowerCase())) {
      return { kind: 'reviewer-paste', reviewer, input: '', effort: (words[3] as string).toLowerCase() }
    }
    if (words.length === 3 || (words.length === 4 && EFFORT_WORD.test((words[3] as string).toLowerCase()))) {
      return { kind: 'reviewer-paste', reviewer, input: words[2] as string, ...(words[3] ? { effort: (words[3] as string).toLowerCase() } : {}) }
    }
    return { kind: 'unknown', text: args.trim() }
  }
  if (validName(head)) {
    const input = args.trim().slice(head.length).trim()
    if (!input) return { kind: 'slot', slot: head }
    if (/^(off|remove|delete)$/i.test(input)) return { kind: 'model', slot: head, model: '' }
    return { kind: 'paste', slot: head, input }
  }
  return null
}

/** Applies a command to the overrides. */
export function applyCrewCommand(overrides: CrewOverrides, command: CrewCommand): CrewOverrides {
  if (command.kind === 'mode') return { ...overrides, mode: command.mode }
  if (command.kind === 'model') {
    const recent = command.model ? [command.model, ...(overrides.recent ?? []).filter((id) => id !== command.model)].slice(0, RECENT_MODELS) : overrides.recent
    const about = command.model && command.about ? { ...(overrides.about ?? {}), [command.model]: command.about } : overrides.about
    const next: CrewOverrides = { ...overrides, models: { ...(overrides.models ?? {}), [command.slot]: command.model } }
    if (recent) next.recent = recent
    if (about) next.about = about
    // A removed model can't stay the junior.
    if (!command.model && next.junior === command.slot) delete next.junior
    return next
  }
  if (command.kind === 'junior') return { ...overrides, junior: command.slot }
  if (command.kind === 'reviewer') return { ...overrides, reviewer: command.reviewer }
  if (command.kind === 'reviewer-choice') {
    const choices = { ...(overrides.reviewerChoices ?? {}) }
    if (command.choice.model || command.choice.effort) choices[command.reviewer] = { ...command.choice }
    else delete choices[command.reviewer]
    return { ...overrides, reviewerChoices: choices }
  }
  return overrides
}

/** `/jev models`: the crew as it stands. */
export function describeCrew(crew: Crew, routerOn: boolean, codexList: readonly CodexModel[] = []): string {
  const lines = [
    `jev-pilot mode: ${crew.mode} (${MODE_INFO[crew.mode]})`,
    `  /jev mode <${MODES.join('|')}>`,
    `custom models (${routerOn ? 'router running' : 'router not running: start Claude Code with claude-jev'}):`,
  ]
  const width = Math.max(6, ...crew.slots.map((slot) => slot.name.length))
  for (const slot of crew.slots) lines.push(`  ${slot.name.padEnd(width)} ${slot.model}${slot.name === crew.junior ? '   (the junior)' : ''}`)
  if (crew.slots.length === 0) lines.push('  none yet')
  lines.push(`  add: /jev <name> <model from openrouter.ai/models> · remove: /jev remove <name> · junior: /jev junior <name>`)
  const said = (r: Reviewer) => describeChoice(crew.reviewerChoices[r], r === 'codex' ? codexList : [])
  lines.push(`reviewer: ${crew.reviewer}   /jev reviewer <codex|opencode>`)
  lines.push(`  codex    ${said('codex')}   /jev reviewer codex <model> [effort] · default`)
  lines.push(`  opencode ${said('opencode')}   /jev reviewer opencode <provider/model> [effort] · default`)
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

/** A model Codex offers, as `codex debug models` lists it. */
export interface CodexModel {
  slug: string
  name: string
  description: string
  efforts: string[]
}

/** Codex's model list from `codex debug models` (the ones it shows; hidden ones left out). */
export function codexCatalog(json: string): CodexModel[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { models?: unknown })?.models
  if (!Array.isArray(list)) return []
  return list
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object' && typeof (m as { slug?: unknown }).slug === 'string')
    .filter((m) => m.visibility === undefined || m.visibility === 'list')
    .map((m) => ({
      slug: m.slug as string,
      name: typeof m.display_name === 'string' ? m.display_name : (m.slug as string),
      description: typeof m.description === 'string' ? m.description : '',
      efforts: Array.isArray(m.supported_reasoning_levels)
        ? (m.supported_reasoning_levels as { effort?: unknown }[]).map((level) => level?.effort).filter((e): e is string => typeof e === 'string')
        : [],
    }))
}

/** A model's short name, its tier, as people say it: `gpt-5.6-luna` → `luna`, `gpt-6-astra` → `astra`. */
export function shortName(slug: string): string {
  return slug.split('-').pop() ?? slug
}

/** The version numbers in a model id, to order a tier's models: `gpt-5.6-luna` → [5, 6]. */
function versionOf(slug: string): number[] {
  return (slug.match(/\d+/g) ?? []).map(Number)
}

function newer(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** Codex's tiers (astra, sol, terra, luna…), each with its newest model now. */
export function codexTiers(catalog: readonly CodexModel[]): Map<string, CodexModel> {
  const tiers = new Map<string, CodexModel>()
  for (const model of catalog) {
    const tier = shortName(model.slug).toLowerCase()
    if (!/^[a-z]+$/.test(tier)) continue
    const held = tiers.get(tier)
    if (!held || newer(versionOf(model.slug), versionOf(held.slug)) > 0) tiers.set(tier, model)
  }
  return tiers
}

/**
 * The model a choice runs on now: a tier (`luna`) is its newest model in
 * Codex's list at this moment, so a new generation is taken up by itself;
 * an id (`gpt-5.6-luna`) stays that model. Unknown to the list: as given.
 */
export function resolvedChoice(reviewer: Reviewer, choice: ReviewerChoice = {}, catalog: readonly CodexModel[] = []): ReviewerChoice {
  if (reviewer !== 'codex' || !choice.model || choice.model.includes('-')) return choice
  const latest = codexTiers(catalog).get(choice.model.toLowerCase())
  return latest ? { ...choice, model: latest.slug } : choice
}

export type ReviewerResolved = { ok: true; choice: ReviewerChoice; about: string } | { ok: false; why: string; suggestions: string[] }

/**
 * `/jev reviewer codex <model> [effort]`, checked against Codex's own list:
 * the id (`gpt-5.6-luna`), its name (`GPT-5.6-Luna`) or its short name
 * (`luna`); the effort must be one that model takes.
 */
export function resolveCodexChoice(input: string, effort: string | undefined, catalog: readonly CodexModel[], current: ReviewerChoice = {}): ReviewerResolved {
  const wanted = input.trim().toLowerCase()
  const tiers = codexTiers(catalog)
  // A tier (`luna`) is kept as the tier: its newest model is used each time.
  // An id or a full name (`gpt-5.6-luna`) pins that exact model.
  let kept: string | undefined = current.model
  let model: CodexModel | undefined
  if (wanted) {
    const tier = tiers.get(wanted)
    const pinned = catalog.find((m) => m.slug.toLowerCase() === wanted) ?? catalog.find((m) => m.name.toLowerCase() === wanted)
    model = tier ?? pinned
    kept = tier ? wanted : pinned?.slug
    if (!model || !kept) {
      return {
        ok: false,
        why: catalog.length > 0 ? `Codex has no model "${input}"` : "Codex's model list couldn't be read (codex debug models)",
        suggestions: [...tiers].map(([name, m]) => `${name} (now ${m.slug}): ${m.description}`),
      }
    }
  } else if (kept) {
    model = tiers.get(kept.toLowerCase()) ?? catalog.find((m) => m.slug === kept)
  }
  const efforts = model?.efforts ?? []
  if (effort && efforts.length > 0 && !efforts.includes(effort)) {
    return { ok: false, why: `${model?.slug ?? 'that model'} doesn't take effort "${effort}"`, suggestions: efforts }
  }
  const keptEffort = effort ?? (wanted ? undefined : current.effort)
  const choice: ReviewerChoice = { ...(kept ? { model: kept } : {}), ...(keptEffort ? { effort: keptEffort } : {}) }
  const about = model ? (wanted && tiers.get(wanted) ? `the newest ${wanted}, now ${model.slug}: ${model.description}` : `${model.name}: ${model.description}`) : ''
  return { ok: true, choice, about }
}

/**
 * `/jev reviewer opencode <model> [effort]`, checked against `opencode
 * models` (provider/model): the full id, or a model name only one provider has.
 */
export function resolveOpencodeChoice(input: string, effort: string | undefined, models: readonly string[], current: ReviewerChoice = {}): ReviewerResolved {
  const wanted = input.trim().toLowerCase()
  let id: string | undefined = current.model
  if (wanted) {
    const exact = models.find((m) => m.toLowerCase() === wanted)
    const byName = models.filter((m) => m.toLowerCase().endsWith(`/${wanted}`))
    id = exact ?? (byName.length === 1 ? byName[0] : undefined)
    if (!id) {
      const close = byName.length > 1 ? byName : models.filter((m) => m.toLowerCase().includes(wanted))
      return { ok: false, why: byName.length > 1 ? `more than one provider has "${input}"` : `OpenCode has no model "${input}"`, suggestions: close.slice(0, 5) }
    }
  }
  return { ok: true, choice: { ...(id ? { model: id } : {}), ...((effort ?? (wanted ? undefined : current.effort)) ? { effort: effort ?? current.effort } : {}) }, about: '' }
}

/** "luna (newest, now gpt-5.6-luna) · effort high", or the CLI's own when nothing is chosen. */
export function describeChoice(choice: ReviewerChoice | undefined, catalog: readonly CodexModel[] = []): string {
  const model = choice?.model
  const now = model && !model.includes('-') ? codexTiers(catalog).get(model.toLowerCase())?.slug : undefined
  const parts = [model ? (now ? `${model} (newest, now ${now})` : model) : undefined, choice?.effort ? `effort ${choice.effort}` : undefined].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : "the CLI's own model and effort"
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

/** The model and effort flags for a reviewer's CLI, as `set --` arguments. */
export function reviewerArgs(reviewer: Reviewer, choice: ReviewerChoice = {}): string {
  const args: string[] = []
  if (choice.model) args.push('-m', shellQuote(choice.model))
  if (choice.effort) args.push(...(reviewer === 'codex' ? ['-c', shellQuote(`model_reasoning_effort="${choice.effort}"`)] : ['--variant', shellQuote(choice.effort)]))
  return `set --${args.length > 0 ? ` ${args.join(' ')}` : ''}`
}

/** The command that runs the review, reading the brief from `$brief` and the flags from `set --`. */
function reviewCommand(reviewer: Reviewer): string {
  return reviewer === 'codex'
    ? 'codex exec "$@" -s read-only --skip-git-repo-check -C "$PWD" -o "$brief.out" - < "$brief" > /dev/null 2> "$brief.err"; echo "exit $?"; cat "$brief.out" 2>/dev/null || tail -20 "$brief.err"'
    : 'opencode run "$@" --agent plan --dir "$PWD" "$(cat "$brief")" < /dev/null 2> "$brief.err"; echo "exit $?"; [ -s "$brief.err" ] && tail -5 "$brief.err"'
}

/** How the reviewer is told which models it may switch to, when the brief asks for one. */
function modelMenu(reviewer: Reviewer, codexModels: readonly CodexModel[]): string[] {
  if (reviewer === 'codex') {
    if (codexModels.length === 0) return ['If the brief asks for a Codex model or effort, pass it with -m <model id> and -c model_reasoning_effort="<effort>" in the set -- line.']
    return [
      'If the brief asks for a particular Codex model or effort for this review, change the set -- line to it (and only then). A model named by its tier means its newest model:',
      ...[...codexTiers(codexModels)].map(([tier, m]) => `  ${tier} = -m '${m.slug}' (${m.description}; efforts: ${m.efforts.join(', ')})`),
      `  an exact id the brief gives (e.g. ${codexModels[0]?.slug ?? 'gpt-…'}) = -m '<that id>'`,
      `  effort: -c 'model_reasoning_effort="<effort>"'`,
      "If it names a model or effort that isn't listed, don't guess: reply that it isn't available, with the list.",
    ]
  }
  return [
    "If the brief asks for a particular OpenCode model or effort, change the set -- line to -m '<provider/model>' and --variant '<effort>'. If you're unsure of the id, run `opencode models | grep -i <name>` first and use the exact line it prints; if it prints none or several, reply with them instead of guessing.",
  ]
}

/**
 * A reviewer's agent definition, registered as `jev-pilot:<reviewer>-review`:
 * a small Claude model that hands the brief to the external CLI and brings
 * its findings back, so the long review stays out of the main conversation.
 */
export function reviewerSpec(reviewer: Reviewer, model: string, choice: ReviewerChoice = {}, codexModels: readonly CodexModel[] = []): AgentSpec {
  const name = REVIEWER_NAME[reviewer]
  return {
    name: `${reviewer}-review`,
    description: `Gets a code review from ${name}, an external coding agent (its own CLI, not Claude), on ${describeChoice(choice)}. Brief it with what changed and why, the files, and what to check; to use another ${name} model or effort for this review, say which in the brief. It returns ${name}'s findings (P1/P2/P3) and verdict. Takes a few minutes: run it in the background when there is other work.`,
    prompt: [
      `You hand a code review to ${name}, an external coding agent, and bring back what it finds. You don't review the code yourself.`,
      'Run one Bash command (timeout 600000), with the brief you were given pasted between the JEV_BRIEF lines exactly as given:',
      '',
      reviewerArgs(reviewer, choice),
      'brief=$(mktemp /tmp/jev-review-XXXXXX); cat > "$brief" <<\'JEV_BRIEF\'',
      REVIEW_INSTRUCTIONS,
      '',
      'The change:',
      '<the brief>',
      'JEV_BRIEF',
      reviewCommand(reviewer),
      '',
      ...modelMenu(reviewer, codexModels),
      '',
      `Then reply with ${name}'s findings and verdict as it gave them, without adding your own, and say which model and effort it ran on.`,
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
export function crewNote(crew: Crew, junior: Slot | null, working: Reviewer[], offered: readonly Slot[] = [], workflows = false): string[] {
  const lines: string[] = []
  if (crew.mode !== 'standard') lines.push(`The user chose the ${crew.mode} mode: ${MODE_INFO[crew.mode]}.`)
  // Workflow agents never pass the Agent tool, so jev-pilot can't route them:
  // the script sets each one's model (agent(prompt, { model })).
  if (workflows) {
    lines.push(
      "Agents a Workflow script starts (agent()) don't pass through jev-pilot, so choose each one's model in the script with opts.model: 'haiku' for searching, reading and reporting, 'sonnet' for ordinary well-specified work, and leave it out for work that needs judgment.",
    )
    if (offered.length > 0) {
      lines.push(
        `In this mode, the user wants bulk work on their custom model: for a workflow agent searching, reading and reporting, or doing other work with nothing to judge, use ${offered.map((slot) => `opts.model: '${slotAlias(slot.name)}' (${slot.model})`).join(' or ')} rather than 'haiku'.`,
      )
    }
  }
  if (junior) {
    lines.push(
      `${JUNIOR_AGENT} is a junior developer on ${junior.model}. Give it easy, well-specified coding changes (the files, the exact behavior, the command that proves it); then read its diff and run the tests yourself before calling the work done, and send it back once with your findings if it needs fixing.`,
    )
  }
  if (working.length > 0) {
    lines.push(
      `External reviewers (their own CLI agents, not Claude): ${working.map((r) => `${reviewerAgent(r)} (${REVIEWER_NAME[r]}, on ${describeChoice(crew.reviewerChoices[r])})`).join(', ')}. Use one when the user asks for a review by it. When the user names a model or effort for the review (for Codex: astra, sol, terra, luna…), put it in the brief as "Model: <name>, effort: <level>".`,
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
export function describeSlot(crew: Crew, name: string, recent: readonly string[] = []): string {
  const slot = crew.slots.find((s) => s.name === name)
  const lines = [
    slot ? `${name}: ${slot.model}${slot.about ? ` (${slot.about})` : ''}${name === crew.junior ? ', the junior' : ''}` : `${name}: no model by that name yet`,
    `  ${slot ? 'replace it' : 'add it'}: /jev ${name} <model>, pasting its id, page link or name from ${MODELS_PAGE}`,
  ]
  if (slot) lines.push(`  use it as the main model: /model ${slotAlias(name)} (in claude-jev) · delete it: /jev remove ${name}`)
  const others = recent.filter((id) => id !== slot?.model)
  if (others.length > 0) lines.push('  set before:', ...others.map((id) => `    /jev ${name} ${id}`))
  return lines.join('\n')
}
