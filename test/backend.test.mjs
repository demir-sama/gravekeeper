import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHmac, createHash } from 'node:crypto'
import { createServer } from '../backend/server.mjs'

async function setup({ watch = ['org/a', 'org/b'], entries = [], secret } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'gkb-'))
  await writeFile(path.join(root, 'watchlist.json'), JSON.stringify({ lychgate: 'https://l.test', repos: watch }))
  await mkdir(path.join(root, 'data'))
  if (entries) await writeFile(path.join(root, 'data', 'walks.json'), JSON.stringify({ version: 1, entries }))
  const server = createServer({ root, secret })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  return { root, server, base, close: () => new Promise((r) => server.close(r)) }
}

const entry = (repo, at, health, extra = {}) => ({
  repo, at, health, counts: { living: 1, tombstone: 0, ghost: 0, drifted: 0, zombie: 0, restless: 0, sealed: 0, total: 1 },
  reportUrl: null, graves: [], ...extra,
})

test('GET /api/walks joins the watchlist with history, oldest to newest', async () => {
  const s = await setup({
    entries: [
      entry('org/a', '2026-11-10T00:00:00Z', 90),
      entry('org/a', '2026-11-17T00:00:00Z', 80, { reportUrl: 'https://l.test/r/abc', graves: [{ url: 'https://x/', cls: 'ghost', snapshot: null, where: [] }] }),
      entry('gone/repo', '2026-11-17T00:00:00Z', 50),
    ],
  })
  const j = await (await fetch(`${s.base}/api/walks`)).json()
  assert.equal(j.lychgate, 'https://l.test')
  assert.deepEqual(j.repos.map((r) => r.repo), ['org/a', 'org/b'])
  const a = j.repos[0]
  assert.deepEqual(a.history.map((h) => h.health), [90, 80])
  assert.equal(a.latest.health, 80)
  assert.equal(a.latest.reportUrl, 'https://l.test/r/abc')
  assert.equal(a.latest.graves.length, 1)
  assert.equal(j.repos[1].latest, null)
  assert.deepEqual(j.repos[1].history, [])
  await s.close()
})

test('missing walks.json gives an empty history, not an error', async () => {
  const s = await setup({ entries: null })
  const r = await fetch(`${s.base}/api/walks`)
  assert.equal(r.status, 200)
  assert.equal((await r.json()).repos[0].latest, null)
  await s.close()
})

test('/health answers without credentials, even when a secret is configured', async () => {
  const s = await setup({ secret: 's3cret' })
  assert.equal((await fetch(`${s.base}/health`)).status, 200)
  await s.close()
})

test('with a secret, /api/walks needs a valid X-KiroCrew-Proxy signature', async () => {
  const secret = 's3cret'
  const s = await setup({ secret })
  assert.equal((await fetch(`${s.base}/api/walks`)).status, 401)
  assert.equal((await fetch(`${s.base}/api/walks`, { headers: { 'x-kirocrew-proxy': '123:abc' } })).status, 401)

  const sign = (ts, target, method = 'GET') =>
    `${ts}:${createHmac('sha256', secret).update(`${ts}:${method}:${target}:${createHash('sha256').update('').digest('hex')}`).digest('hex')}`
  const ts = Math.floor(Date.now() / 1000)
  assert.equal((await fetch(`${s.base}/api/walks`, { headers: { 'x-kirocrew-proxy': sign(ts, '/api/walks') } })).status, 200)
  // signature for another path
  assert.equal((await fetch(`${s.base}/api/walks`, { headers: { 'x-kirocrew-proxy': sign(ts, '/api/other') } })).status, 401)
  // stale timestamp
  assert.equal((await fetch(`${s.base}/api/walks`, { headers: { 'x-kirocrew-proxy': sign(ts - 120, '/api/walks') } })).status, 401)
  await s.close()
})

test('only GET is served; unknown paths 404; nothing is written', async () => {
  const s = await setup()
  const before = await readdir(path.join(s.root, 'data'))
  assert.equal((await fetch(`${s.base}/api/walks`, { method: 'POST', body: '{}' })).status, 405)
  assert.equal((await fetch(`${s.base}/api/walks`, { method: 'DELETE' })).status, 405)
  assert.equal((await fetch(`${s.base}/api/nope`)).status, 404)
  assert.equal((await fetch(`${s.base}/../../etc/passwd`)).status, 404)
  assert.deepEqual(await readdir(path.join(s.root, 'data')), before)
  await s.close()
})

test('a corrupt walks.json answers 500 with a message, not a crash', async () => {
  const s = await setup()
  await writeFile(path.join(s.root, 'data', 'walks.json'), '{bad')
  const r = await fetch(`${s.base}/api/walks`)
  assert.equal(r.status, 500)
  assert.match((await r.json()).error, /walks\.json/)
  assert.equal((await fetch(`${s.base}/health`)).status, 200)
  await s.close()
})
