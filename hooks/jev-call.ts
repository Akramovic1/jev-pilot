/**
 * jev-pilot — one request to Jev per prompt.
 *
 * Two modules ask Jev about the same prompt: the router (effort, model,
 * strategy) and the skill picker (which skill, if any). They used to ask one
 * after the other, three requests in a row (the router's, the skill ranking,
 * and a re-read of the shortlist): about 1.5 s before each turn. Now the
 * router hands its questions down, and the skill module, which runs inside
 * it on the same prompt, sends them with its own in one request. One request
 * with both sets of questions takes as long as the slower of the two alone,
 * and answers them the same (measured: same effort, tier and strategy on
 * every prompt tried).
 *
 * The hand-off: the router's prompt.submit offers its part, then passes the
 * prompt on; the skill module's takes it, asks (`ask`, with its own
 * questions added), and gives the answer back (`settle`), which returns the
 * router's block for the prompt (strategy advice). A part nobody took is
 * asked for by the router itself once the prompt comes back up.
 */
import type { Miss } from './model-router.policy.ts'

export interface Answer {
  /** The response body, or null with why (`miss`). */
  text: string | null
  miss: Miss | null
  ms: number
}

export interface RouterPart {
  /** The prompt this part is for: a part is only ever taken for its own prompt. */
  prompt: string
  /**
   * One request with the router's questions and `extra` (the skill
   * module's), in the router's state (the prompt, recent context, signals).
   */
  ask: (extra: Record<string, unknown>) => Promise<Answer>
  /** Hands the answer to the router; returns its block for the prompt, if any. */
  settle: (answer: Answer) => Promise<string | null>
}

let offered: RouterPart | null = null

/** The router's part for this prompt, waiting for the skill module. */
export function offerPart(part: RouterPart): void {
  offered = part
}

/** Takes the part for this prompt, once: null when there is none for it. */
export function takePart(prompt: string): RouterPart | null {
  const part = offered
  offered = null
  return part && part.prompt === prompt ? part : null
}

/** Whether the part offered for this prompt is still waiting (nobody took it). */
export function stillOffered(part: RouterPart): boolean {
  if (offered !== part) return false
  offered = null
  return true
}

/**
 * A prompt that only says to go on with the work in progress ("continue",
 * "keep going"): the turn before already decided how to do that work, so
 * Jev isn't asked again. An approval ("yes", "go ahead", "do it") is not one:
 * it often starts the very work the turn before only proposed.
 */
export function isContinuation(prompt: string): boolean {
  return /^(?:please\s+)?(?:continue|go on|keep going|carry on|resume)(?:\s+please)?[.!]*$/i.test(prompt.trim())
}
