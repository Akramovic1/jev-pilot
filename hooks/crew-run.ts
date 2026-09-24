/**
 * jev-pilot — starting the crew for a session and checking every worker.
 *
 * The hooks hand in the engine calls this needs (`CrewIo`); `$` never leaves
 * the hook. Checks are cheap: a 1-token call per custom model on OpenRouter,
 * `codex login status`, `opencode --version` and `opencode auth list`.
 */
import { aboutModel, juniorSlot, juniorSpec, overridesOf, pickerSettings, recordedModels, REVIEWERS, reviewerSpec, routerTable, slotAlias, type AgentSpec, type OpenRouterModel } from './crew.ts'
import { codexVerdict, crew, crewOverrides, crewStarted, markCrewStarted, opencodeVerdict, reviewerHealthy, router, setCrewOverrides, setHealth, setRouter } from './crew-state.ts'

export interface CrewIo {
  fetch: (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; text: string }>
  /** $HOME and $JEV_ROUTER_URL: the only variables this reads. */
  home: () => Promise<string | undefined>
  routerUrl: () => Promise<string | undefined>
  write: (path: string, text: string) => Promise<void>
  /** A file's text, or null when it isn't there. */
  read: (path: string) => Promise<string | null>
  run: (argv: string[], timeoutMs: number) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  storeGet: (key: string) => Promise<unknown>
  sleep: (ms: number) => Promise<void>
  /** Registers an agent type, `jev-pilot:<name>`. */
  register: (spec: AgentSpec) => Promise<void>
}

export const CREW_KEY = 'crew'

/** The router's address as shown to you: without the secret in its path. */
export function shownUrl(url: string): string {
  return url.replace(/\/[0-9a-f]{16,}$/i, '')
}

/** Where the router reads the slots from. */
export async function modelsFile(io: CrewIo): Promise<string> {
  const home = (await io.home()) ?? '~'
  return `${home}/.claude/jev-pilot/models.json`
}

/** The `/model` rows `claude-jev` passes to Claude Code with `--settings`. */
export async function pickerFile(io: CrewIo): Promise<string> {
  const home = (await io.home()) ?? '~'
  return `${home}/.claude/jev-pilot/picker.json`
}

/**
 * Writes the router's table and the record of what's set (models.json), and
 * the `/model` rows (picker.json), from the crew as it stands now.
 */
export async function publishSlots(io: CrewIo): Promise<void> {
  await io.write(await modelsFile(io), routerTable(crew(), crewOverrides()))
  await io.write(await pickerFile(io), pickerSettings(crew()))
}

async function within<T>(io: Pick<CrewIo, 'sleep'>, ms: number, work: Promise<T>): Promise<T | null> {
  return Promise.race([work, io.sleep(ms).then(() => null)])
}

/** A session's crew: the saved `/jev` changes, the router, the slots file. */
export async function startCrew(io: CrewIo): Promise<void> {
  markCrewStarted()
  // The mode, junior and reviewer from the store; the models from
  // models.json, which every install and project shares, and which holds
  // the latest change made anywhere.
  const stored = overridesOf(await io.storeGet(CREW_KEY).catch(() => undefined))
  const recorded = recordedModels(await io.read(await modelsFile(io)).catch(() => null))
  setCrewOverrides(recorded ? { ...stored, ...recorded } : stored)
  const url = (await io.routerUrl())?.replace(/\/$/, '') || null
  setRouter(null)
  if (url) {
    const answer = await within(io, 1500, io.fetch(`${url}/jev-router/health`, { method: 'GET' }).catch(() => null))
    const ok = !!answer && answer.ok
    setHealth('router', { ok, detail: ok ? shownUrl(url) : `no answer at ${shownUrl(url)}`, at: Date.now() })
    if (ok) setRouter(url)
  }
  await publishSlots(io).catch(() => undefined)
}

/** Checks one custom model: a 1-token request on OpenRouter. */
export async function checkSlot(io: CrewIo, key: string | null, name: string, model: string): Promise<void> {
  if (!key) {
    setHealth(`slot:${name}`, { ok: false, detail: `${model} · no OpenRouter key`, at: Date.now() })
    return
  }
  const answer = await within(
    io,
    8000,
    io
      .fetch('https://openrouter.ai/api/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ok' }] }),
      })
      .catch(() => null),
  )
  const ok = !!answer && answer.ok
  const why = answer ? `HTTP ${answer.status}: ${answer.text.slice(0, 80)}` : 'no answer in 8s'
  setHealth(`slot:${name}`, { ok, detail: ok ? `${model} · answering` : `${model} · ${why}`, at: Date.now() })
}

/** Checks the external agents: installed, and logged in. */
export async function checkAgents(io: CrewIo): Promise<void> {
  try {
    const codex = await io.run(['codex', 'login', 'status'], 15_000)
    const verdict = codexVerdict(codex.exitCode, `${codex.stdout}\n${codex.stderr}`)
    setHealth('agent:codex', { ...verdict, at: Date.now() })
  } catch {
    setHealth('agent:codex', { ok: false, detail: 'codex not installed', at: Date.now() })
  }
  try {
    const version = await io.run(['opencode', '--version'], 15_000)
    const auth = version.exitCode === 0 ? await io.run(['opencode', 'auth', 'list'], 15_000) : { stdout: '', stderr: '', exitCode: 1 }
    setHealth('agent:opencode', { ...opencodeVerdict(version.exitCode, version.stdout, `${auth.stdout}\n${auth.stderr}`), at: Date.now() })
  } catch {
    setHealth('agent:opencode', { ok: false, detail: 'opencode not installed', at: Date.now() })
  }
}

/** The router still answering, and any custom model it had to hand to Claude. */
export async function checkRouter(io: CrewIo): Promise<void> {
  const url = router()
  if (!url) return
  const answer = await within(io, 1500, io.fetch(`${url}/jev-router/health`, { method: 'GET' }).catch(() => null))
  if (!answer || !answer.ok) {
    setHealth('router', { ok: false, detail: `no answer at ${shownUrl(url)}`, at: Date.now() })
    return
  }
  setHealth('router', { ok: true, detail: `${shownUrl(url)}${fallbackNote(answer.text)}`, at: Date.now() })
}

/** "· alpha fell back to claude-sonnet-5 2× (OpenRouter 503)", from the router's health answer. */
export function fallbackNote(healthText: string): string {
  try {
    const fallbacks = (JSON.parse(healthText) as { fallbacks?: Record<string, { count?: number; to?: string; why?: string }> }).fallbacks ?? {}
    const notes = Object.entries(fallbacks)
      .filter(([, f]) => typeof f?.count === 'number' && f.count > 0)
      .map(([slot, f]) => `${slot} fell back to ${f.to ?? 'Claude'} ${f.count}× (last: ${String(f.why ?? '').slice(0, 60)})`)
    return notes.length > 0 ? ` · ${notes.join('; ')}` : ''
  } catch {
    return ''
  }
}

/** Every check, in parallel; then what OpenRouter says each model is, where that's missing. */
export async function checkCrew(io: CrewIo, key: string | null): Promise<void> {
  await Promise.all([...crew().slots.map((slot) => checkSlot(io, key, slot.name, slot.model)), checkAgents(io), checkRouter(io)])
  await fillAbout(io).catch(() => undefined)
}

/**
 * A model set without its description (before descriptions were kept, or
 * while OpenRouter's list was out of reach): looked up once it's there, for
 * `/model` and `/jev status`.
 */
export async function fillAbout(io: CrewIo): Promise<void> {
  const missing = crew().slots.filter((slot) => !slot.about)
  if (missing.length === 0) return
  const catalog = await modelCatalog(io)
  if (!catalog) return
  const about = { ...(crewOverrides().about ?? {}) }
  for (const slot of missing) {
    const found = catalog.find((model) => model.id === slot.model)
    if (found) about[slot.model] = aboutModel(found)
  }
  if (Object.keys(about).length === Object.keys(crewOverrides().about ?? {}).length) return
  setCrewOverrides({ ...crewOverrides(), about })
  await publishSlots(io)
}

/** The small Claude model a reviewer runs on: it only relays. */
export const REVIEWER_MODEL = 'haiku'

/**
 * The crew's agent types: the junior in junior-lead mode (with the router
 * up), and each reviewer whose CLI passed its check.
 */
export async function registerCrew(io: CrewIo): Promise<void> {
  const junior = juniorSlot(crew(), router() !== null)
  const specs = [...(junior ? [juniorSpec(slotAlias(junior.name))] : []), ...REVIEWERS.filter(reviewerHealthy).map((r) => reviewerSpec(r, REVIEWER_MODEL))]
  for (const spec of specs) await io.register(spec).catch(() => undefined)
}

/** A session's crew, start to finish: set up, agents registered, then checked and registered again. */
export async function startSession(io: CrewIo, key: string | null): Promise<void> {
  await startCrew(io).catch(() => undefined)
  await registerCrew(io)
  void checkCrew(io, key)
    .then(() => registerCrew(io))
    .catch(() => undefined)
}

/**
 * The crew, set up if this worker hasn't yet: a reload mid-session (a plugin
 * update) starts a fresh worker without a session start, and routing must
 * not think the router is gone. Checks run in the background.
 */
export async function ensureCrew(io: CrewIo, key: string | null): Promise<void> {
  if (!crewStarted()) await startSession(io, key)
  else await refreshModels(io, key)
}

/**
 * The models set in another session since this one started (models.json
 * changed): taken up here too, and a newly set model checked. One small
 * file read per prompt.
 */
export async function refreshModels(io: CrewIo, key: string | null): Promise<void> {
  const recorded = recordedModels(await io.read(await modelsFile(io)).catch(() => null))
  if (!recorded) return
  const current = crewOverrides()
  const before = crew().slots
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  if (same(recorded.models, current.models) && same(recorded.recent, current.recent) && same(recorded.about, current.about)) return
  setCrewOverrides({ ...current, ...recorded })
  for (const slot of crew().slots) {
    if (!before.some((b) => b.name === slot.name && b.model === slot.model)) void checkSlot(io, key, slot.name, slot.model).catch(() => undefined)
  }
  await registerCrew(io)
}

let catalogCache: { at: number; models: OpenRouterModel[] } | null = null

/**
 * OpenRouter's model list, to check what `/jev <slot>` was given against
 * (public, no key). Kept 10 minutes; null when it can't be read in 6 s.
 */
export async function modelCatalog(io: CrewIo): Promise<OpenRouterModel[] | null> {
  if (catalogCache && Date.now() - catalogCache.at < 600_000) return catalogCache.models
  const answer = await within(io, 6000, io.fetch('https://openrouter.ai/api/v1/models', { method: 'GET' }).catch(() => null))
  if (!answer || !answer.ok) return null
  try {
    const models = (JSON.parse(answer.text) as { data?: unknown }).data
    if (!Array.isArray(models)) return null
    catalogCache = { at: Date.now(), models: models.filter((m): m is OpenRouterModel => !!m && typeof (m as OpenRouterModel).id === 'string') }
    return catalogCache.models
  } catch {
    return null
  }
}

let fallbacksSeen: number | null = null

/**
 * New fallbacks since the last look: each custom model that failed and was
 * answered by Claude instead, with why. Empty on the first look (it only
 * counts from there) and when the router isn't answering.
 */
export async function newFallbacks(io: Pick<CrewIo, 'fetch' | 'sleep'>): Promise<string[]> {
  const url = router()
  if (!url) return []
  const answer = await within(io, 800, io.fetch(`${url}/jev-router/health`, { method: 'GET' }).catch(() => null))
  if (!answer || !answer.ok) return []
  try {
    const fallbacks = (JSON.parse(answer.text) as { fallbacks?: Record<string, { count?: number; to?: string; why?: string }> }).fallbacks ?? {}
    const total = Object.values(fallbacks).reduce((sum, f) => sum + (typeof f?.count === 'number' ? f.count : 0), 0)
    const before = fallbacksSeen
    fallbacksSeen = total
    if (before === null || total <= before) return []
    return Object.entries(fallbacks).map(([name, f]) => `${name} failed (${String(f.why ?? '').slice(0, 90)}), so ${f.to ?? 'Claude'} answered instead`)
  } catch {
    return []
  }
}
