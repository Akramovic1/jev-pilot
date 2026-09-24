#!/usr/bin/env node
/**
 * jev-router — lets one Claude Code session use custom models next to Claude.
 *
 * Claude Code talks to one server. This router is that server, on
 * 127.0.0.1: a request naming one of jev-pilot's custom model slots
 * (`jev-alpha`, `jev-beta`, `jev-gamma`, ...) goes to that slot's model on
 * OpenRouter, which speaks the same Anthropic Messages format; every other
 * request streams through to Anthropic unchanged, with its own headers, so
 * your Claude login and plan work exactly as before.
 *
 * Nothing crosses over: the OpenRouter key is only ever sent to OpenRouter,
 * and the Claude login only ever to Anthropic. The slots are read from
 * ~/.claude/jev-pilot/models.json (written by jev-pilot) on every request, so
 * `/jev alpha <model>` applies at once.
 *
 * A custom model that fails (OpenRouter down or busy, the model gone, no
 * key, no answer in time) never fails the work: the same request goes to
 * Anthropic instead, as Sonnet (the id learned from the session's own
 * requests), under the session's own login. Only a failure after the answer
 * has started streaming can't be taken back.
 *
 * Started by `claude-jev`, under a small supervisor that restarts it if it
 * dies; runs with Node 18+ or Bun, no dependencies.
 *   JEV_ROUTER_PORT              port (8799)
 *   JEV_ROUTER_UPSTREAM          where Claude requests go (https://api.anthropic.com)
 *   JEV_OPENROUTER_KEY           the OpenRouter key (else jev-pilot's own option)
 *   JEV_ROUTER_SLOT_TIMEOUT_MS   how long a custom model has to start answering (60000)
 *   JEV_ROUTER_FALLBACK_MODEL    the Claude model a failed request goes to (else the Sonnet seen)
 */
import { createServer } from 'node:http'
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

const PORT = Number(process.env.JEV_ROUTER_PORT ?? 8799)
const UPSTREAM = (process.env.JEV_ROUTER_UPSTREAM ?? 'https://api.anthropic.com').replace(/\/$/, '')
const OPENROUTER = 'https://openrouter.ai/api/v1/messages'
const DIR = join(homedir(), '.claude', 'jev-pilot')
const MODELS = join(DIR, 'models.json')
const LOG = join(DIR, 'router.log')
/** Bumped with every change here: `claude-jev` replaces a running router of another version. */
export const ROUTER_VERSION = '2'
const SLOT_TIMEOUT_MS = Number(process.env.JEV_ROUTER_SLOT_TIMEOUT_MS ?? 60000)

/** The slots, re-read whenever the file changes: { alpha: { model: 'deepseek/...' }, ... }. */
let slots = {}
let slotsSeen = 0
function currentSlots() {
  try {
    const mtime = statSync(MODELS).mtimeMs
    if (mtime !== slotsSeen) {
      slots = JSON.parse(readFileSync(MODELS, 'utf8')).slots ?? {}
      slotsSeen = mtime
    }
  } catch {
    slots = {}
  }
  return slots
}

/** The OpenRouter key: the environment, else jev-pilot's option in Claude Code's settings. */
function openrouterKey() {
  if (process.env.JEV_OPENROUTER_KEY) return process.env.JEV_OPENROUTER_KEY
  for (const file of [join(homedir(), '.claude', 'settings.json'), join(homedir(), '.claude', '.credentials.json')]) {
    try {
      const data = JSON.parse(readFileSync(file, 'utf8'))
      for (const [name, entry] of Object.entries(data.pluginConfigs ?? {})) {
        if (name.startsWith('jev-pilot') && entry?.options?.openrouterApiKey) return entry.options.openrouterApiKey
      }
    } catch {}
  }
  return null
}

/** The slot a model name asks for, or null: `jev-alpha` → the alpha slot's OpenRouter model. */
export function slotOf(model, table) {
  const match = /^jev-([a-z0-9]+)$/.exec(String(model ?? ''))
  const slot = match && table[match[1]]
  return slot && slot.model ? { name: match[1], model: slot.model } : null
}

/**
 * The Claude model a failed custom-model request goes to: the one set, else
 * the newest Sonnet id this router has passed through, else any Claude id it
 * has (the main conversation's). Learned, not written here, so a new model
 * generation needs no router update.
 */
const SEEN = join(DIR, 'router-models.json')
// Kept on disk, so a restarted router can fall back before it sees a request.
const seen = (() => {
  try {
    const stored = JSON.parse(readFileSync(SEEN, 'utf8'))
    return { sonnet: stored.sonnet ?? null, any: stored.any ?? null }
  } catch {
    return { sonnet: null, any: null }
  }
})()
/** Remembers a Claude model id; true when that changed what was known. */
export function learnModel(model, into = seen) {
  const id = String(model ?? '')
  if (!/^claude-/.test(id)) return false
  const before = `${into.sonnet} ${into.any}`
  into.any = id
  if (/sonnet/.test(id)) into.sonnet = id
  return `${into.sonnet} ${into.any}` !== before
}
export function fallbackModel(from = seen, env = process.env) {
  return env.JEV_ROUTER_FALLBACK_MODEL || from.sonnet || from.any || null
}

/** Each slot's fallbacks since the router started, for `/jev status`. */
const fallbacks = {}

function log(line) {
  try {
    mkdirSync(DIR, { recursive: true })
    appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`)
  } catch {}
}

/** Passes a response on as received: fetch has already decoded the body. */
function relay(upstream, res) {
  const headers = {}
  upstream.headers.forEach((value, key) => {
    if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key)) headers[key] = value
  })
  res.writeHead(upstream.status, headers)
  if (!upstream.body) return res.end()
  Readable.fromWeb(upstream.body).pipe(res)
}

/** A request to Anthropic with the session's own headers (its login included). */
function passThrough(req, url, body) {
  const headers = {}
  for (const [key, value] of Object.entries(req.headers)) {
    if (!['host', 'connection', 'content-length', 'accept-encoding'].includes(key)) headers[key] = value
  }
  headers['accept-encoding'] = 'identity'
  return fetch(`${UPSTREAM}${url.pathname}${url.search}`, { method: req.method, headers, body })
}

/** Runs `work` with an abort after `ms` without a response (the body may stream on after). */
async function withTimeout(ms, work) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`no answer in ${Math.round(ms / 1000)}s`)), ms)
  try {
    return await work(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

async function body(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/jev-router/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ ok: true, version: ROUTER_VERSION, pid: process.pid, slots: Object.entries(currentSlots()).filter(([, slot]) => slot && slot.model).map(([name]) => name), upstream: UPSTREAM, fallbacks }))
    }
    // `claude-jev` stopping a router of another version: it exits cleanly,
    // and its supervisor with it.
    if (url.pathname === '/jev-router/stop' && req.method === 'POST') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      log('stopping on request')
      return setTimeout(() => process.exit(0), 50)
    }
    const raw = req.method === 'GET' || req.method === 'HEAD' ? undefined : await body(req)
    let parsed = null
    try {
      parsed = raw && raw.length ? JSON.parse(raw.toString('utf8')) : null
    } catch {}
    const slot = parsed ? slotOf(parsed.model, currentSlots()) : null
    if (parsed && !slot && learnModel(parsed.model)) {
      try {
        mkdirSync(DIR, { recursive: true })
        writeFileSync(SEEN, JSON.stringify(seen))
      } catch {}
    }

    if (slot && url.pathname.endsWith('/messages/count_tokens')) {
      // OpenRouter has no token counter: an estimate is all Claude Code needs here.
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ input_tokens: Math.ceil(raw.length / 4) }))
    }
    if (slot && url.pathname.endsWith('/messages')) {
      const key = openrouterKey()
      let why = 'no OpenRouter key'
      // What to answer when there is nowhere to fall back to: OpenRouter's own
      // status (a bad model id is not worth retrying), else 502 (retried).
      let status = 502
      if (key) {
        log(`jev-${slot.name} → ${slot.model}`)
        const upstream = await withTimeout(SLOT_TIMEOUT_MS, (signal) =>
          fetch(OPENROUTER, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${key}`,
              'anthropic-version': req.headers['anthropic-version'] ?? '2023-06-01',
              'accept-encoding': 'identity',
              'http-referer': 'https://github.com/Akramovic1/jev-pilot',
              'x-title': 'jev-pilot',
            },
            body: JSON.stringify({ ...parsed, model: slot.model }),
            signal,
          }),
        ).catch((error) => ({ failed: String(error) }))
        if (upstream.ok) return relay(upstream, res)
        why = upstream.failed ?? `OpenRouter ${upstream.status}: ${(await upstream.text().catch(() => '')).slice(0, 120)}`
        if (!upstream.failed && upstream.status >= 400 && upstream.status < 500 && upstream.status !== 429) status = upstream.status
      }
      // The custom model failed: Claude takes the same request.
      const model = fallbackModel()
      if (!model) {
        log(`jev-${slot.name} failed (${why}); no Claude model seen yet to fall back to`)
        res.writeHead(status, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ type: 'error', error: { type: status === 502 ? 'api_error' : 'invalid_request_error', message: `jev-router: jev-${slot.name} failed: ${why}` } }))
      }
      fallbacks[slot.name] = { count: (fallbacks[slot.name]?.count ?? 0) + 1, why, at: new Date().toISOString(), to: model }
      log(`jev-${slot.name} failed (${why}); falling back to ${model}`)
      return relay(await passThrough(req, url, JSON.stringify({ ...parsed, model })), res)
    }

    // Everything else: to Anthropic as it came, headers and all.
    return relay(await passThrough(req, url, raw), res)
  } catch (error) {
    log(`error: ${String(error)}`)
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: `jev-router: ${String(error)}` } }))
  }
})

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  // One stray error never takes the router down; a hard crash is the supervisor's.
  process.on('uncaughtException', (error) => log(`uncaught: ${String(error)}`))
  process.on('unhandledRejection', (error) => log(`unhandled: ${String(error)}`))
  server.on('error', (error) => {
    // Another router already has the port: that one serves, this one leaves
    // (exit 0 tells the supervisor not to restart it).
    log(`not listening: ${String(error)}`)
    process.exit(error && error.code === 'EADDRINUSE' ? 0 : 1)
  })
  server.listen(PORT, '127.0.0.1', () => log(`listening on 127.0.0.1:${PORT} (v${ROUTER_VERSION}), Claude → ${UPSTREAM}`))
}
