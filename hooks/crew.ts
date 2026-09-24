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

export const DEFAULT_SLOTS: Record<SlotName, { model: string; when: string }> = {
  alpha: { model: 'deepseek/deepseek-v4.1-flash', when: DEFAULT_SLOT_WHEN },
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
}

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

/** The router's table, written to ~/.claude/jev-pilot/models.json. */
export function routerTable(crew: Crew): string {
  return JSON.stringify({ slots: Object.fromEntries(crew.slots.map((slot) => [slot.name, { model: slot.model }])) }, null, 2)
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
  | { kind: 'model'; slot: SlotName; model: string }
  | { kind: 'junior'; slot: SlotName }
  | { kind: 'reviewer'; reviewer: Reviewer }
  | { kind: 'unknown'; text: string }

/**
 * `/jev` arguments about the crew, or null when they're about something else:
 *   models                      the crew: mode, slots, junior, reviewer
 *   mode <name>                 standard · budget · junior-lead · second-opinion · quality
 *   alpha <openrouter model>    a slot's model (beta, gamma likewise); `off` clears it
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
  if (head && SLOT_NAMES.includes(head as SlotName) && words.length === 2) {
    const value = words[1] as string
    if (value.toLowerCase() === 'off') return { kind: 'model', slot: head as SlotName, model: '' }
    // An OpenRouter id: provider/model, optionally with a :variant or a ~ alias.
    if (/^~?[\w.-]+\/[\w.:-]+$/.test(value)) return { kind: 'model', slot: head as SlotName, model: value }
    return { kind: 'unknown', text: args.trim() }
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
  if (command.kind === 'model') return { ...overrides, models: { ...(overrides.models ?? {}), [command.slot]: command.model } }
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
    lines.push(`  ${name.padEnd(6)} ${slot ? slot.model : 'off'}${name === crew.junior ? '   (the junior)' : ''}`)
  }
  lines.push(`  /jev <alpha|beta|gamma> <openrouter model>|off · /jev junior <slot>`)
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
