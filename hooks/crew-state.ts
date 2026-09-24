/**
 * jev-pilot — the crew as this session has it: the options, what `/jev`
 * changed, whether the router is up, and each worker's last health check.
 * Shared, like features.ts: the router module routes with it, the pet module's
 * `/jev` changes and shows it.
 */
import { crewOf, type Crew, type CrewOverrides, type Reviewer, type Slot } from './crew.ts'

export type Health = { ok: boolean; detail: string; at: number }

let options: Record<string, unknown> = {}
let overrides: CrewOverrides = {}
let routerUrl: string | null = null
let started = false
const health = new Map<string, Health>()

export function initCrew(from: Record<string, unknown>): void {
  options = { ...from }
  overrides = {}
  routerUrl = null
  started = false
  health.clear()
}

/** Whether this worker has set the crew up: after a reload it hasn't, until a hook does. */
export function crewStarted(): boolean {
  return started
}

export function markCrewStarted(): void {
  started = true
}

export function crew(): Crew {
  return crewOf(options, overrides)
}

export function crewOverrides(): CrewOverrides {
  return { ...overrides }
}

export function setCrewOverrides(next: CrewOverrides): void {
  overrides = { ...next }
}

/** The router's address when `claude-jev` started one and it answered; null otherwise. */
export function router(): string | null {
  return routerUrl
}

export function setRouter(url: string | null): void {
  routerUrl = url
}

/** Health keys: `router`, `slot:alpha`, `agent:codex`, ... */
export function setHealth(key: string, value: Health): void {
  health.set(key, value)
}

export function healthOf(key: string): Health | null {
  return health.get(key) ?? null
}

/** A slot is usable once its last check passed (unchecked counts as not yet). */
export function slotHealthy(slot: Slot): boolean {
  const h = health.get(`slot:${slot.name}`)
  return !!h && h.ok && h.detail.startsWith(slot.model)
}

/**
 * A slot that may be used: answering its last check, or not checked yet (a
 * headless run's first prompt arrives before the check). An unchecked slot
 * is safe to try: if it fails, the router gives the request to Claude.
 * Only a slot that failed its check is left out.
 */
export function slotUsable(slot: Slot): boolean {
  const h = health.get(`slot:${slot.name}`)
  return !h || !h.detail.startsWith(slot.model) || h.ok
}

export function reviewerHealthy(reviewer: Reviewer): boolean {
  return health.get(`agent:${reviewer}`)?.ok === true
}

/** The health lines for `/jev status`. */
export function describeHealth(): string {
  const c = crew()
  const mark = (h: Health | null) => (h === null ? '·  not checked' : h.ok ? `✓  ${h.detail}` : `✗  ${h.detail}`)
  const lines = ['health:']
  lines.push(`  router     ${routerUrl ? mark(health.get('router') ?? null) : '✗  not running (start Claude Code with claude-jev)'}`)
  for (const slot of c.slots) lines.push(`  ${slot.name.padEnd(10)} ${mark(health.get(`slot:${slot.name}`) ?? null)}`)
  for (const agent of ['codex', 'opencode']) lines.push(`  ${agent.padEnd(10)} ${mark(health.get(`agent:${agent}`) ?? null)}`)
  return lines.join('\n')
}

// ---- the checks' verdicts, pure: the hooks run them and hand the output here ----

/** Codex is working when `codex login status` exits 0 and says it's logged in. */
export function codexVerdict(exitCode: number, output: string): { ok: boolean; detail: string } {
  if (exitCode !== 0) return { ok: false, detail: `codex login status failed: ${output.trim().slice(0, 80) || `exit ${exitCode}`}` }
  const line = output.trim().split('\n')[0] ?? ''
  return /^logged in\b/i.test(line) ? { ok: true, detail: line } : { ok: false, detail: `not logged in: ${line.slice(0, 80)}` }
}

/** OpenCode is working when it runs and has at least one provider logged in. */
export function opencodeVerdict(versionExit: number, version: string, authOutput: string): { ok: boolean; detail: string } {
  if (versionExit !== 0) return { ok: false, detail: 'opencode not found or not starting' }
  const plain = authOutput.replace(/\x1b\[[0-9;]*m/g, '')
  const providers = [...plain.matchAll(/●\s+([^\n]+?)\s+(?:oauth|api|wellknown)\b/g)].map((m) => (m[1] as string).trim())
  return providers.length > 0
    ? { ok: true, detail: `opencode ${version.trim()} · ${providers.slice(0, 3).join(', ')}${providers.length > 3 ? '…' : ''}` }
    : { ok: false, detail: `opencode ${version.trim()} has no provider logged in (opencode auth login)` }
}
