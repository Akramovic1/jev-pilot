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
 * Started by `claude-jev`; runs with Node 18+ or Bun, no dependencies.
 *   JEV_ROUTER_PORT       port (8799)
 *   JEV_ROUTER_UPSTREAM   where Claude requests go (https://api.anthropic.com)
 *   JEV_OPENROUTER_KEY    the OpenRouter key (else jev-pilot's own option)
 */
import { createServer } from 'node:http'
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

const PORT = Number(process.env.JEV_ROUTER_PORT ?? 8799)
const UPSTREAM = (process.env.JEV_ROUTER_UPSTREAM ?? 'https://api.anthropic.com').replace(/\/$/, '')
const OPENROUTER = 'https://openrouter.ai/api/v1/messages'
const DIR = join(homedir(), '.claude', 'jev-pilot')
const MODELS = join(DIR, 'models.json')
const LOG = join(DIR, 'router.log')

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
      return res.end(JSON.stringify({ ok: true, slots: Object.keys(currentSlots()), upstream: UPSTREAM }))
    }
    const raw = req.method === 'GET' || req.method === 'HEAD' ? undefined : await body(req)
    let parsed = null
    try {
      parsed = raw && raw.length ? JSON.parse(raw.toString('utf8')) : null
    } catch {}
    const slot = parsed ? slotOf(parsed.model, currentSlots()) : null

    if (slot && url.pathname.endsWith('/messages/count_tokens')) {
      // OpenRouter has no token counter: an estimate is all Claude Code needs here.
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ input_tokens: Math.ceil(raw.length / 4) }))
    }
    if (slot && url.pathname.endsWith('/messages')) {
      const key = openrouterKey()
      if (!key) {
        res.writeHead(401, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'jev-router: no OpenRouter key (set jev-pilot\'s openrouterApiKey)' } }))
      }
      log(`jev-${slot.name} → ${slot.model}`)
      const upstream = await fetch(OPENROUTER, {
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
      })
      return relay(upstream, res)
    }

    // Everything else: to Anthropic as it came, headers and all.
    const headers = {}
    for (const [key, value] of Object.entries(req.headers)) {
      if (!['host', 'connection', 'content-length', 'accept-encoding'].includes(key)) headers[key] = value
    }
    headers['accept-encoding'] = 'identity'
    const upstream = await fetch(`${UPSTREAM}${url.pathname}${url.search}`, { method: req.method, headers, body: raw })
    return relay(upstream, res)
  } catch (error) {
    log(`error: ${String(error)}`)
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: `jev-router: ${String(error)}` } }))
  }
})

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  server.listen(PORT, '127.0.0.1', () => log(`listening on 127.0.0.1:${PORT}, Claude → ${UPSTREAM}`))
}
