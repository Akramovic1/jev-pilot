/**
 * jev-pilot — tuning learned from the ledger.
 *
 * Every 20 turns the router reads the decision ledger (ledger.ts) and, when
 * it points one way (low starts that keep getting raised, high starts that
 * finish in two tool calls, answers arriving too late), proposes a change in
 * one line. `/jev tune apply` takes it: the change is kept in the store, on
 * top of your settings, and applies at once. `/jev tune reset` goes back to
 * the settings. Nothing changes without the command.
 *
 * Shared, like crew-state.ts: the router routes with the effective values,
 * the pet module's `/jev` changes them.
 */
import type { LedgerEntry, Suggestion, TunableConfig } from './ledger.ts'
import { MIN_TURNS_TO_SUGGEST, suggestions } from './ledger.ts'

export const TUNING_KEY = 'tuning'

export interface Tuning {
  /** Values changed from the settings. */
  values: Partial<TunableConfig>
  /** When they last changed: only turns after this are evidence for the next change. */
  since: number
}

/** The range each tunable value is kept in, whatever the store holds. */
const RANGES: Record<keyof TunableConfig, [number, number]> = {
  timeoutMs: [300, 5000],
  minDowngradeConfidence: [0, 0.95],
  effortCloseMargin: [0, 0.5],
  minHighConfidence: [0, 0.95],
}

let base: TunableConfig | null = null
let tuning: Tuning = { values: {}, since: 0 }
let loaded = false
let applier: ((config: TunableConfig) => void) | null = null

/** The settings' values, and how to put new ones in force (the router's). */
export function initTuning(from: TunableConfig, apply: (config: TunableConfig) => void): void {
  base = { ...from }
  applier = apply
  tuning = { values: {}, since: 0 }
  loaded = false
}

/** The values in force: the settings with the learned changes on top. */
export function effective(): TunableConfig {
  return { ...(base as TunableConfig), ...tuning.values }
}

export function currentTuning(): Tuning {
  return { values: { ...tuning.values }, since: tuning.since }
}

/** Whether the store has been read in this worker (a reload starts over). */
export function tuningLoaded(): boolean {
  return loaded
}

/** Puts a tuning in force. */
export function setTuning(next: Tuning): void {
  tuning = { values: { ...next.values }, since: next.since }
  loaded = true
  if (base) applier?.(effective())
}

/** A tuning read back from the store: unknown keys dropped, values kept in range. */
export function tuningOf(stored: unknown): Tuning {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return { values: {}, since: 0 }
  const raw = stored as { values?: unknown; since?: unknown }
  const values: Partial<TunableConfig> = {}
  if (raw.values && typeof raw.values === 'object' && !Array.isArray(raw.values)) {
    for (const [key, range] of Object.entries(RANGES) as [keyof TunableConfig, [number, number]][]) {
      const value = (raw.values as Record<string, unknown>)[key]
      if (typeof value === 'number' && Number.isFinite(value)) values[key] = Math.min(range[1], Math.max(range[0], value))
    }
  }
  return { values, since: typeof raw.since === 'number' && Number.isFinite(raw.since) ? raw.since : 0 }
}

/** The turns that count as evidence now: those since the last change. */
export function evidence(entries: readonly LedgerEntry[], since = tuning.since): LedgerEntry[] {
  return entries.filter((entry) => entry.at > since)
}

/** What the ledger suggests now, from the turns since the last change. */
export function proposals(entries: readonly LedgerEntry[]): Suggestion[] {
  return base ? suggestions(evidence(entries), effective()) : []
}

/**
 * Whether to propose after this turn: every 20 turns of new evidence, when
 * the evidence suggests something. Once per 20, so it never nags.
 */
export function dueToPropose(entries: readonly LedgerEntry[]): Suggestion[] {
  const fresh = evidence(entries)
  if (fresh.length < MIN_TURNS_TO_SUGGEST || fresh.length % 20 !== 0) return []
  return proposals(entries)
}

/** The tuning with the suggestions applied, from `now` on. */
export function applied(current: Tuning, found: readonly Suggestion[], now: number): Tuning {
  const values = { ...current.values }
  for (const suggestion of found) values[suggestion.option] = suggestion.to
  return tuningOf({ values, since: now })
}

/** `/jev tune`: what is tuned, and what the ledger suggests. */
export function describeTuning(entries: readonly LedgerEntry[]): string {
  const now = effective()
  const set = base as TunableConfig
  const lines = ['jev-pilot tuning (learned from your ledger; your settings are unchanged):']
  for (const key of Object.keys(RANGES) as (keyof TunableConfig)[]) {
    const tuned = tuning.values[key]
    lines.push(`  ${key.padEnd(24)} ${now[key]}${tuned !== undefined && tuned !== set[key] ? `   (settings: ${set[key]})` : ''}`)
  }
  const fresh = evidence(entries).length
  const found = proposals(entries)
  lines.push('')
  if (found.length > 0) {
    lines.push(`From your last ${fresh} turns, it suggests:`)
    for (const s of found) lines.push(`  ${s.option}: ${s.from} → ${s.to}, because ${s.why}`)
    lines.push('  /jev tune apply takes these · /jev tune reset goes back to your settings')
  } else if (fresh < MIN_TURNS_TO_SUGGEST) {
    lines.push(`No suggestion yet: ${fresh} of the ${MIN_TURNS_TO_SUGGEST} turns it needs since the last change.`)
  } else {
    lines.push(`Nothing to change: your last ${fresh} turns point no one way.`)
  }
  return lines.join('\n')
}
