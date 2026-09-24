/**
 * jev-pilot — starting the crew for a session and checking every worker.
 *
 * The hooks hand in the engine calls this needs (`CrewIo`); `$` never leaves
 * the hook. Checks are cheap: a 1-token call per custom model on OpenRouter,
 * `codex login status`, `opencode --version` and `opencode auth list`.
 */
import { juniorSlot, juniorSpec, overridesOf, REVIEWERS, reviewerSpec, routerTable, slotAlias, type AgentSpec } from './crew.ts'
import { codexVerdict, crew, crewStarted, markCrewStarted, opencodeVerdict, reviewerHealthy, router, setCrewOverrides, setHealth, setRouter } from './crew-state.ts'

export interface CrewIo {
  fetch: (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; text: string }>
  /** $HOME and $JEV_ROUTER_URL: the only variables this reads. */
  home: () => Promise<string | undefined>
  routerUrl: () => Promise<string | undefined>
  write: (path: string, text: string) => Promise<void>
  run: (argv: string[], timeoutMs: number) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  storeGet: (key: string) => Promise<unknown>
  sleep: (ms: number) => Promise<void>
  /** Registers an agent type, `jev-pilot:<name>`. */
  register: (spec: AgentSpec) => Promise<void>
}

export const CREW_KEY = 'crew'

/** Where the router reads the slots from. */
export async function modelsFile(io: CrewIo): Promise<string> {
  const home = (await io.home()) ?? '~'
  return `${home}/.claude/jev-pilot/models.json`
}

/** Writes the router's table from the crew as it stands now. */
export async function publishSlots(io: CrewIo): Promise<void> {
  await io.write(await modelsFile(io), routerTable(crew()))
}

async function within<T>(io: CrewIo, ms: number, work: Promise<T>): Promise<T | null> {
  return Promise.race([work, io.sleep(ms).then(() => null)])
}

/** A session's crew: the saved `/jev` changes, the router, the slots file. */
export async function startCrew(io: CrewIo): Promise<void> {
  markCrewStarted()
  setCrewOverrides(overridesOf(await io.storeGet(CREW_KEY).catch(() => undefined)))
  const url = (await io.routerUrl())?.replace(/\/$/, '') || null
  setRouter(null)
  if (url) {
    const answer = await within(io, 1500, io.fetch(`${url}/jev-router/health`, { method: 'GET' }).catch(() => null))
    const ok = !!answer && answer.ok
    setHealth('router', { ok, detail: ok ? url : `no answer at ${url}`, at: Date.now() })
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

/** Every check, in parallel. */
export async function checkCrew(io: CrewIo, key: string | null): Promise<void> {
  await Promise.all([...crew().slots.map((slot) => checkSlot(io, key, slot.name, slot.model)), checkAgents(io)])
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
}
