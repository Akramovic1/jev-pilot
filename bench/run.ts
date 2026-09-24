/**
 * jev-bench: the same small coding tasks, run by Claude Code headless with and
 * without jev-pilot, each checked automatically. Reports whether each task
 * passed, its tokens and cost, and the cost per passed task.
 *
 *   bun bench/run.ts                       every task, every setup, once
 *   bun bench/run.ts --tasks 1-rename --setups off,jev --runs 2 --budget 0.5 --max-turns 25
 *
 * Each run gets a fresh copy of bench/fixture and a lean Claude Code config
 * (your login only: no other plugins, skills or MCP servers), so every setup
 * starts from the same place. Setups:
 *   off      no jev-pilot, effort high (Claude Code's usual default)
 *   jev      jev-pilot loaded, effort starting at medium
 *   junior   jev with the junior-lead mode: easy coding can go to a junior on
 *            the alpha slot (through jev-router), reviewed by the main model.
 *            Run on the coding tasks only (--junior-tasks). Claude Code can't
 *            price a custom model, so its tokens are re-priced at OpenRouter's
 *            live price for the slot's model.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const HERE = import.meta.dir
const REPO = join(HERE, '..')
const arg = (name: string, fallback: string) => {
  const at = process.argv.indexOf(`--${name}`)
  return at > 0 ? (process.argv[at + 1] as string) : fallback
}
const tasks = arg('tasks', readdirSync(join(HERE, 'tasks')).sort().join(',')).split(',')
const setups = arg('setups', 'off,jev,junior').split(',')
const juniorTasks = arg('junior-tasks', '2-slugify,5-duration,6-discount,8-validate').split(',')
const runs = Number(arg('runs', '1'))
const budget = arg('budget', '0.5')
const maxTurns = arg('max-turns', '25')
const work = arg('work', join(tmpdir(), `jev-bench-${Date.now()}`))

const home = homedir()
const credentials = JSON.parse(readFileSync(join(home, '.claude/.credentials.json'), 'utf8'))
const userSettings = JSON.parse(readFileSync(join(home, '.claude/settings.json'), 'utf8'))
const jevOptions = userSettings.pluginConfigs?.['jev-pilot']?.options ?? {}

// The junior setup goes through jev-router: started here if it isn't running.
const ROUTER = `http://127.0.0.1:${process.env.JEV_ROUTER_PORT ?? 8799}`
async function routerUp(): Promise<boolean> {
  return fetch(`${ROUTER}/jev-router/health`).then((r) => r.ok, () => false)
}
if (setups.includes('junior') && !(await routerUp())) {
  Bun.spawn(['node', join(REPO, 'router/jev-router.mjs')], { stdio: ['ignore', 'ignore', 'ignore'] }).unref()
  for (let i = 0; i < 20 && !(await routerUp()); i++) await Bun.sleep(200)
  if (!(await routerUp())) throw new Error('jev-router did not start; the junior setup needs it')
}
/** OpenRouter's price per token for each slot model, read live (never written here). */
const slotModels: Record<string, string> = (() => {
  try {
    const table = JSON.parse(readFileSync(join(home, '.claude/jev-pilot/models.json'), 'utf8')).slots ?? {}
    return Object.fromEntries(Object.entries(table).filter(([, slot]: [string, any]) => slot?.model).map(([name, slot]: [string, any]) => [`jev-${name}`, slot.model]))
  } catch {
    return {}
  }
})()
if (setups.includes('junior') && !slotModels['jev-alpha']) {
  throw new Error('the junior setup runs the junior on the alpha slot: set a model first (/jev alpha <model> in a claude-jev session)')
}
const prices: Record<string, { prompt: number; completion: number }> = {}
if (setups.includes('junior')) {
  const list = await fetch('https://openrouter.ai/api/v1/models').then((r) => r.json() as Promise<{ data: any[] }>)
  for (const [alias, model] of Object.entries(slotModels)) {
    const found = list.data.find((m) => m.id === model)
    if (found) prices[alias] = { prompt: Number(found.pricing.prompt), completion: Number(found.pricing.completion) }
  }
}

const ALLOWED = ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Agent', 'Bash(bun:*)', 'Bash(grep:*)', 'Bash(ls:*)', 'Bash(cat:*)', 'Bash(git diff:*)', 'Bash(git status:*)']

interface Result {
  task: string
  setup: string
  run: number
  passed: boolean
  costUsd: number | null
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  turns: number | null
  seconds: number | null
  stopped: string | null
  models: Record<string, number>
  jev: string[]
}

function sh(cmd: string[], cwd: string, env: Record<string, string> = {}, timeoutMs = 900_000) {
  const out = Bun.spawnSync(cmd, { cwd, env: { ...process.env, ...env }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', timeout: timeoutMs })
  return { code: out.exitCode, stdout: out.stdout.toString(), stderr: out.stderr.toString() }
}

function freshProject(dir: string) {
  mkdirSync(dir, { recursive: true })
  cpSync(join(HERE, 'fixture'), dir, { recursive: true })
  sh(['git', 'init', '-q'], dir)
  sh(['git', 'add', '-A'], dir)
  sh(['git', '-c', 'user.email=bench@jev', '-c', 'user.name=bench', 'commit', '-qm', 'fixture'], dir)
}

function leanConfig(dir: string, withJev: boolean, extra: Record<string, unknown> = {}) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: credentials.claudeAiOauth }), { mode: 0o600 })
  const settings = withJev ? { pluginConfigs: { 'jev-pilot': { options: { ...jevOptions, recordDecisions: true, ...extra } } } } : {}
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings))
}

/** jev-pilot's own record of each turn, from its store in the lean config. */
function jevDecisions(config: string): string[] {
  const store = join(config, 'plugins/store')
  if (!existsSync(store)) return []
  const lines: string[] = []
  for (const file of readdirSync(store).filter((f) => f.startsWith('jev-pilot'))) {
    const ledger = JSON.parse(readFileSync(join(store, file), 'utf8')).ledger
    for (const e of Array.isArray(ledger) ? ledger : (ledger?.entries ?? [])) {
      lines.push(e.answered ? `${e.startedFrom ?? '?'}→${e.started ?? '?'}${e.raisedTo ? ` raised ${e.raisedTo}` : ''} (${e.tier})` : 'no answer')
    }
  }
  return lines
}

function once(task: string, setup: string, run: number): Result {
  const dir = join(work, `${task}-${setup}-${run}`)
  const project = join(dir, 'project')
  const config = join(dir, 'config')
  freshProject(project)
  const withJev = setup !== 'off'
  leanConfig(config, withJev, setup === 'junior' ? { mode: 'junior-lead' } : {})
  const prompt = readFileSync(join(HERE, 'tasks', task, 'prompt.txt'), 'utf8').trim()
  const cmd = ['claude', '-p', prompt, '--output-format', 'json', '--max-budget-usd', budget, '--max-turns', maxTurns, '--permission-mode', 'acceptEdits', '--allowedTools', ...ALLOWED]
  cmd.push('--effort', withJev ? 'medium' : 'high')
  if (withJev) cmd.push('--plugin-dir', REPO)
  const env: Record<string, string> = { CLAUDE_CONFIG_DIR: config }
  if (withJev) env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS = '1'
  if (setup === 'junior') Object.assign(env, { ANTHROPIC_BASE_URL: ROUTER, JEV_ROUTER_URL: ROUTER, ENABLE_TOOL_SEARCH: 'true' })
  const out = sh(cmd, project, env)
  let parsed: any = null
  try {
    parsed = JSON.parse(out.stdout.slice(out.stdout.indexOf('{')))
  } catch {
    parsed = null
  }
  const verify = sh(['bash', join(HERE, 'tasks', task, 'verify.sh')], project, {}, 300_000)
  const usage = parsed?.usage ?? {}
  const models: Record<string, number> = {}
  let cost: number | null = typeof parsed?.total_cost_usd === 'number' ? parsed.total_cost_usd : null
  for (const [model, u] of Object.entries(parsed?.modelUsage ?? {}) as [string, any][]) {
    let modelCost = u.costUSD ?? 0
    // A custom model: Claude Code's figure replaced by OpenRouter's price.
    if (prices[model] && cost !== null) {
      const input = (u.inputTokens ?? 0) + (u.cacheReadInputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0)
      const real = input * prices[model].prompt + (u.outputTokens ?? 0) * prices[model].completion
      cost = cost - modelCost + real
      modelCost = real
    }
    models[model.replace(/^claude-/, '').replace(/-\d{8}$/, '')] = Math.round(modelCost * 1000) / 1000
  }
  return {
    task,
    setup,
    run,
    passed: verify.code === 0,
    costUsd: cost,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    turns: parsed?.num_turns ?? null,
    seconds: parsed?.duration_ms ? Math.round(parsed.duration_ms / 1000) : null,
    stopped: parsed ? (parsed.subtype !== 'success' ? parsed.subtype : null) : `no result (exit ${out.code}): ${out.stderr.slice(0, 160)}`,
    models,
    jev: withJev ? jevDecisions(config) : [],
  }
}

const results: Result[] = []
mkdirSync(work, { recursive: true })
console.log(`jev-bench · ${tasks.length} tasks × ${setups.length} setups × ${runs} run(s) · cap $${budget} and ${maxTurns} turns per run · work in ${work}`)
for (const task of tasks) {
  for (let run = 1; run <= runs; run++) {
    for (const setup of setups) {
      if (setup === 'junior' && !juniorTasks.includes(task)) continue
      const r = once(task, setup, run)
      results.push(r)
      const models = Object.entries(r.models).map(([m, c]) => `${m} $${c}`).join(', ')
      console.log(`${r.passed ? 'PASS' : 'FAIL'} ${task.padEnd(10)} ${setup.padEnd(4)} $${r.costUsd?.toFixed(3) ?? '?'} · out ${r.outputTokens} · ${r.turns ?? '?'} turns · ${r.seconds ?? '?'}s${r.stopped ? ` · stopped: ${r.stopped}` : ''} · ${models}${r.jev.length ? ` · jev: ${r.jev.join('; ')}` : ''}`)
    }
  }
}

const out = join(HERE, 'results')
mkdirSync(out, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
writeFileSync(join(out, `${stamp}.json`), JSON.stringify(results, null, 1))

const table = (title: string, pick: (r: Result) => boolean) => {
  console.log(`\n${title}\n| setup | passed | total cost | cost per passed task | output tokens | time |`)
  console.log('|---|---|---|---|---|---|')
  for (const setup of setups) {
    const rs = results.filter((r) => r.setup === setup && pick(r))
    if (rs.length === 0) continue
    row(setup, rs)
  }
}
const row = (setup: string, rs: Result[]) => {
  const passed = rs.filter((r) => r.passed).length
  const cost = rs.reduce((s, r) => s + (r.costUsd ?? 0), 0)
  const outTokens = rs.reduce((s, r) => s + r.outputTokens, 0)
  const secs = rs.reduce((s, r) => s + (r.seconds ?? 0), 0)
  console.log(`| ${setup} | ${passed}/${rs.length} | $${cost.toFixed(2)} | ${passed ? `$${(cost / passed).toFixed(3)}` : '—'} | ${outTokens} | ${secs}s |`)
}
table('All tasks (the junior runs only the coding tasks):', () => true)
if (setups.includes('junior')) table('The coding tasks, every setup:', (r) => juniorTasks.includes(r.task))
console.log(`\nresults: bench/results/${stamp}.json`)
