/**
 * jev-pilot — what the decision model is shown of the conversation, and
 * which prompts are tasks at all.
 *
 * Pure, like the policy modules: the hooks read `$.session.messages()` and
 * hand the list here. Only message text and tool names travel, never a tool's
 * input or output: those hold file contents and command output, which is more
 * than a classifier needs and more than should leave the machine.
 */

/** Prompt origins that are not a task of the person's: nothing to plan or suggest for. */
export const NOT_A_TASK: ReadonlySet<string> = new Set([
  'task-notification',
  'peer',
  'peer-send-message',
  'projects-relay',
  'observer',
  'observer-activity',
  'scheduled-trigger',
  'slack-ping',
])

/** The part of a transcript message this module reads (`SessionMessage`). */
export interface ContextMessage {
  role: 'user' | 'assistant'
  text: string
  toolUses?: readonly { tool: string; isError?: true }[]
  toolResults?: readonly { isError: boolean }[]
}

export interface ContextLimits {
  /** How many messages before the prompt to include; 0 sends none. */
  messages: number
  /** The most characters all of them may take together. */
  chars: number
}

/** A message as one line: who, what they said, and which tools ran. */
function lineOf(message: ContextMessage, cap: number, tail = 0): string | null {
  const text = message.text.replace(/\s+/g, ' ').trim()
  const tools = (message.toolUses ?? []).map((use) => (use.isError ? `${use.tool} (failed)` : use.tool))
  if (!text && tools.length === 0) return null
  // With a tail, a long message keeps its beginning and its end: where a
  // reply asks its question ("Shall I start?") is usually the end.
  const said =
    text.length <= cap ? text : tail > 0 && tail < cap ? `${text.slice(0, cap - tail)} … ${text.slice(-tail)}` : `${text.slice(0, cap)}…`
  const ran = tools.length > 0 ? ` [tools: ${tools.join(', ')}]` : ''
  return `${message.role}: ${said}${ran}`
}

/**
 * The conversation just before `prompt`, newest last, as the text the
 * decision model reads beside it; '' when there is none or `messages` is 0.
 *
 * The prompt itself is dropped when the transcript already holds it, so it is
 * never counted twice. Messages that carry only tool results (no text) are
 * skipped: their outcome already shows on the tool call as "(failed)". The
 * newest messages win the character budget; older ones are dropped, not
 * squeezed. The newest is always sent, cut to the budget if it must be.
 */
export function recentContext(
  messages: readonly ContextMessage[],
  prompt: string,
  limits: ContextLimits,
): string {
  if (limits.messages <= 0 || limits.chars <= 0) return ''
  let list = messages
  const last = list.at(-1)
  if (last && last.role === 'user' && last.text.trim() === prompt.trim()) list = list.slice(0, -1)

  // The newest assistant message is what a short reply answers ("yes", "1",
  // "fix all and continue"), and its proposal is usually at its end: it gets
  // about half the budget and keeps its beginning and its end; the others
  // share the rest.
  const cap = Math.max(200, Math.floor(limits.chars / limits.messages))
  let newestAssistant = -1
  for (let index = list.length - 1; index >= 0; index--) {
    if ((list[index] as ContextMessage).role === 'assistant' && (list[index] as ContextMessage).text.trim()) {
      newestAssistant = index
      break
    }
  }
  const bigCap = Math.min(limits.chars, Math.max(cap, Math.floor(limits.chars * 0.55)))
  const otherCap = newestAssistant >= 0 && limits.messages > 1 ? Math.max(200, Math.floor((limits.chars - bigCap) / (limits.messages - 1))) : cap
  const lines: string[] = []
  let used = 0
  for (let index = list.length - 1; index >= 0 && lines.length < limits.messages; index--) {
    const message = list[index] as ContextMessage
    const line = index === newestAssistant ? lineOf(message, bigCap, Math.floor(bigCap * 0.72)) : lineOf(message, otherCap)
    if (!line) continue
    if (used + line.length > limits.chars) {
      // A budget smaller than one message still carries the newest one.
      if (lines.length === 0) lines.unshift(`${line.slice(0, Math.max(0, limits.chars - 1))}…`)
      break
    }
    lines.unshift(line)
    used += line.length + 1
  }
  return lines.join('\n')
}

/**
 * Plain facts about a request, sent beside it so the decision model does not
 * have to infer them from prose: how long it is, how many files it names,
 * whether it carries code or an error, whether it is phrased as a question,
 * and what the recent turns did with their tools. Counts and flags only;
 * nothing here quotes the conversation.
 */
export interface Signals {
  prompt_chars: number
  files_mentioned: number
  has_code_or_error: boolean
  is_question: boolean
  /** Tool use over the last `window` messages, by kind. */
  recent_tools: { edits: number; commands: number; reads: number; subagents: number; failed: number }
}

const TOOL_KINDS: Record<string, keyof Omit<Signals['recent_tools'], 'failed'>> = {
  Edit: 'edits',
  MultiEdit: 'edits',
  Write: 'edits',
  NotebookEdit: 'edits',
  Bash: 'commands',
  PowerShell: 'commands',
  Read: 'reads',
  Grep: 'reads',
  Glob: 'reads',
  LS: 'reads',
  WebFetch: 'reads',
  WebSearch: 'reads',
  Agent: 'subagents',
  Task: 'subagents',
}

const PATH = /(?:^|[\s`'"(])((?:[\w.-]+\/)+[\w.-]+|[\w-]+\.(?:tsx?|jsx?|mjs|py|go|rs|java|kt|swift|rb|php|cs|c|cc|cpp|h|hpp|sql|json|ya?ml|toml|md|css|scss|html|sh|lock))(?=$|[\s`'"),:;])/g
const CODE_OR_ERROR = /```|Traceback|Exception|\berror\b|\bfailed\b|stack ?trace|\bat \S+:\d+/i
const QUESTION = /^(what|why|how|when|where|which|who|can|could|does|do|did|is|are|should|would|will)\b/i

export function signalsOf(prompt: string, messages: readonly ContextMessage[], window = 10): Signals {
  const text = prompt.trim()
  const files = new Set<string>()
  for (const match of text.matchAll(PATH)) files.add(match[1] as string)
  const tools = { edits: 0, commands: 0, reads: 0, subagents: 0, failed: 0 }
  for (const message of messages.slice(-window)) {
    for (const use of message.toolUses ?? []) {
      const kind = TOOL_KINDS[use.tool]
      if (kind) tools[kind]++
      if (use.isError) tools.failed++
    }
  }
  return {
    prompt_chars: text.length,
    files_mentioned: files.size,
    has_code_or_error: CODE_OR_ERROR.test(text),
    is_question: text.endsWith('?') || QUESTION.test(text),
    recent_tools: tools,
  }
}

// ---- what the project deploys with ------------------------------------------------------

/**
 * The files that show which platform a project deploys to or builds on, by
 * what they're called. Read from the project's top folder and one level down
 * (infra/cdk.json, apps/api/Dockerfile), never their contents.
 */
const PLATFORM_MARKERS: [RegExp, string][] = [
  [/(^|\/)vercel\.json$|(^|\/)\.vercel\/$/, 'Vercel'],
  [/(^|\/)cdk\.json$/, 'AWS CDK'],
  [/(^|\/)serverless\.(yml|yaml|ts|js)$/, 'AWS Serverless'],
  [/(^|\/)template\.ya?ml$|(^|\/)samconfig\.toml$/, 'AWS SAM'],
  [/(^|\/)buildspec\.ya?ml$/, 'AWS CodeBuild'],
  [/(^|\/)amplify\.ya?ml$|(^|\/)amplify\/$/, 'AWS Amplify'],
  [/(^|\/)netlify\.toml$/, 'Netlify'],
  [/(^|\/)firebase\.json$/, 'Firebase'],
  [/(^|\/)supabase\/config\.toml$/, 'Supabase'],
  [/(^|\/)fly\.toml$/, 'Fly.io'],
  [/(^|\/)wrangler\.(toml|json|jsonc)$/, 'Cloudflare Workers'],
  [/(^|\/)app\.ya?ml$|(^|\/)cloudbuild\.ya?ml$/, 'Google Cloud'],
  [/(^|\/)render\.ya?ml$/, 'Render'],
  [/(^|\/)railway\.(json|toml)$/, 'Railway'],
  [/(^|\/)(docker-)?compose\.ya?ml$/, 'Docker Compose'],
  [/(^|\/)Dockerfile$/, 'Docker'],
  [/(^|\/)\.github\/workflows\/$/, 'GitHub Actions'],
  [/(^|\/)bitbucket-pipelines\.yml$/, 'Bitbucket Pipelines'],
]

/** Folders never looked into for platform files: dependencies and build output. */
export const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', 'cdk.out', 'vendor', 'target', '.venv', 'venv', '__pycache__', 'coverage'])

/**
 * What a project deploys to or builds on, from its file names (folders end
 * in "/"): "AWS CDK, Docker", or "none found". Jev reads it so a platform's
 * skill (Vercel's, say) fits only a project that uses that platform.
 */
export function platformsOf(paths: readonly string[]): string {
  const found: string[] = []
  for (const [marker, name] of PLATFORM_MARKERS) {
    if (!found.includes(name) && paths.some((path) => marker.test(path))) found.push(name)
  }
  return found.length > 0 ? found.join(', ') : 'none found'
}
