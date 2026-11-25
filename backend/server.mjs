// Gravekeeper dashboard backend: read-only JSON for the UI. Node 22+, no dependencies.
// The gateway starts it with PORT set and reaches it through /apps/gravekeeper/api/*.
// It never writes; only scripts/walk.mjs writes data/.

import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createHmac, createHash, timingSafeEqual } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MAX_SKEW_S = 60

function verifyProxy(header, { method, target, secret, nowMs }) {
  if (typeof header !== 'string') return false
  const i = header.indexOf(':')
  if (i < 1) return false
  const ts = header.slice(0, i)
  const sig = header.slice(i + 1)
  if (!/^\d{1,12}$/.test(ts) || !sig) return false
  if (Math.abs(nowMs / 1000 - Number(ts)) > MAX_SKEW_S) return false
  const bodyHash = createHash('sha256').update('').digest('hex')
  const expected = createHmac('sha256', secret).update(`${ts}:${method}:${target}:${bodyHash}`).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(sig)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return fallback
    throw err
  }
}

async function buildWalks(root, dataDir) {
  const wl = await readJson(path.join(root, 'watchlist.json'), { repos: [] })
  let walks
  try {
    walks = await readJson(path.join(dataDir, 'walks.json'), { entries: [] })
  } catch {
    throw new Error('data/walks.json is not valid JSON')
  }
  const entries = Array.isArray(walks.entries) ? walks.entries : []
  const repos = (Array.isArray(wl.repos) ? wl.repos : []).map((repo) => {
    const mine = entries.filter((e) => e && e.repo === repo).sort((a, b) => String(a.at).localeCompare(String(b.at)))
    return {
      repo,
      latest: mine.length ? mine[mine.length - 1] : null,
      history: mine.map((e) => ({ at: e.at, health: e.health })),
    }
  })
  return { lychgate: wl.lychgate ?? null, repos }
}

export function createServer({ root = DEFAULT_ROOT, dataDir, secret = process.env.KIROCREW_PROXY_SECRET, now = Date.now } = {}) {
  const data = dataDir ?? path.join(root, 'data')
  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
    res.end(JSON.stringify(body))
  }
  return http.createServer(async (req, res) => {
    const target = req.url ?? '/'
    const pathname = target.split('?')[0]
    if (pathname === '/health') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' })
      return send(res, 200, { ok: true })
    }
    if (pathname !== '/api/walks') return send(res, 404, { error: 'not found' })
    if (req.method !== 'GET') {
      res.setHeader('allow', 'GET')
      return send(res, 405, { error: 'method not allowed' })
    }
    if (secret && !verifyProxy(req.headers['x-kirocrew-proxy'], { method: 'GET', target, secret, nowMs: now() })) {
      return send(res, 401, { error: 'unauthorized' })
    }
    try {
      send(res, 200, await buildWalks(root, data))
    } catch (err) {
      send(res, 500, { error: err.message })
    }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('gravekeeper backend: PORT is not set')
    process.exit(1)
  }
  const dataDir = process.env.GRAVEKEEPER_DATA_DIR ? path.resolve(process.env.GRAVEKEEPER_DATA_DIR) : undefined
  createServer({ dataDir }).listen(port, '127.0.0.1')
}
