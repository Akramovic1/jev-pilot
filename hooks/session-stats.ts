/**
 * jev-pilot — what jev-pilot did this session, counted as it happens: turns
 * started below or above the session's own effort, and subagents sent to a
 * cheaper model than the conversation's (with the tokens they then used).
 * Shown by `/jev`, and in the bubble every tenth turn.
 *
 * Counts, not dollars: prices change and differ by plan, and a turn's
 * counterfactual cost (at the other effort) is not something anyone saw.
 * Shared, like summary.ts: the router counts, the pet module shows.
 */

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const FAMILIES = ['haiku', 'sonnet', 'opus']

interface Stats {
  turns: number
  lower: number
  higher: number
  /** The effort the session was set to (what the engine built the last turn with). */
  base: string | null
  /** Subagents on a cheaper model than the conversation's, by model. */
  cheaper: Record<string, number>
  subagents: number
  /** Tokens used by those cheaper subagents (input, cache included, and output). */
  tokens: number
}

let stats: Stats = fresh()
const cheaperAgents = new Map<string, string>()

function fresh(): Stats {
  return { turns: 0, lower: 0, higher: 0, base: null, cheaper: {}, subagents: 0, tokens: 0 }
}

export function resetStats(): void {
  stats = fresh()
  cheaperAgents.clear()
}

/** A main-conversation turn: the effort the engine built it with, and the one it started at. */
export function recordTurn(from: string | null, started: string | null): number {
  stats.turns++
  if (from) stats.base = from
  const a = from ? EFFORTS.indexOf(from) : -1
  const b = started ? EFFORTS.indexOf(started) : -1
  if (a >= 0 && b >= 0 && b < a) stats.lower++
  if (a >= 0 && b >= 0 && b > a) stats.higher++
  return stats.turns
}

/** How a model ranks on cost: a custom model (`jev-…`) lowest, then Haiku, Sonnet, Opus; unknown: null. */
export function costRank(model: string | null | undefined): number | null {
  const id = String(model ?? '').toLowerCase()
  if (id.startsWith('jev-')) return -1
  const family = FAMILIES.findIndex((name) => id.includes(name))
  return family >= 0 ? family : null
}

/** A subagent started: counted as cheaper when its model ranks below the conversation's. */
export function recordSubagent(agentId: string | undefined, model: string | null, parent: string | null | undefined): void {
  stats.subagents++
  const mine = costRank(model)
  const theirs = costRank(parent)
  if (mine === null || theirs === null || mine >= theirs || !model) return
  const name = model.startsWith('jev-') ? model : (FAMILIES.find((family) => model.toLowerCase().includes(family)) as string)
  stats.cheaper[name] = (stats.cheaper[name] ?? 0) + 1
  if (agentId) cheaperAgents.set(agentId, name)
  while (cheaperAgents.size > 64) cheaperAgents.delete(cheaperAgents.keys().next().value as string)
}

/** A subagent's run ended: its tokens count when it ran on a cheaper model. */
export function recordSubagentUsage(agentId: string, usage: Record<string, unknown> | null | undefined): void {
  if (!cheaperAgents.has(agentId) || !usage) return
  cheaperAgents.delete(agentId)
  for (const key of ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']) {
    const value = usage[key]
    if (typeof value === 'number' && Number.isFinite(value)) stats.tokens += value
  }
}

function tokens(count: number): string {
  return count >= 1_000_000 ? `${(count / 1_000_000).toFixed(1)}M` : count >= 1000 ? `${Math.round(count / 1000)}k` : String(count)
}

/** `/jev`: the session so far, in a line or two. */
export function describeStats(): string {
  if (stats.turns === 0 && stats.subagents === 0) return 'this session: nothing decided yet'
  const parts = [`this session: ${stats.turns} turn${stats.turns === 1 ? '' : 's'}`]
  if (stats.base) parts.push(`${stats.lower} started below your ${stats.base} effort, ${stats.higher} above`)
  const cheap = Object.values(stats.cheaper).reduce((sum, n) => sum + n, 0)
  if (stats.subagents > 0) {
    const which = Object.entries(stats.cheaper).map(([name, n]) => `${n} ${name}`).join(', ')
    parts.push(`${cheap} of ${stats.subagents} subagent${stats.subagents === 1 ? '' : 's'} on a cheaper model${which ? ` (${which})` : ''}`)
    if (stats.tokens > 0) parts.push(`${tokens(stats.tokens)} tokens on them instead of the main model`)
  }
  return parts.join(' · ')
}

/** The bubble's version: short. */
export function shortStats(): string {
  const cheap = Object.values(stats.cheaper).reduce((sum, n) => sum + n, 0)
  const parts = [`${stats.lower}/${stats.turns} turns below ${stats.base ?? 'default'}`]
  if (cheap > 0) parts.push(`${cheap} cheaper subagent${cheap === 1 ? '' : 's'}`)
  return `session · ${parts.join(' · ')}`
}
