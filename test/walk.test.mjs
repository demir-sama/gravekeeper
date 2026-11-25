import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, mkdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { walk, validateRepo, loadWatchlist, toShared } from '../scripts/walk.mjs'

const LYCH = 'https://lychgate.test'

async function makeRoot(watchlist, history) {
  const root = await mkdtemp(path.join(tmpdir(), 'gk-'))
  await writeFile(path.join(root, 'watchlist.json'), JSON.stringify(watchlist))
  if (history) {
    await mkdir(path.join(root, 'data'), { recursive: true })
    await writeFile(path.join(root, 'data', 'walks.json'), JSON.stringify(history))
  }
  return root
}

const result = (url, cls, extra = {}) => ({
  type: 'result',
  result: {
    url, cls, confidence: 0.9, reasons: ['r'], redirects: [{ from: 'x', to: 'y' }], ms: 12,
    occurrences: [{ doc: 'README.md', line: 3 }], ...extra,
  },
})
const done = (counts, health) => ({
  type: 'done', ms: 5,
  summary: { living: 0, tombstone: 0, ghost: 0, drifted: 0, zombie: 0, restless: 0, sealed: 0, total: 0, health, ...counts },
})
const ndjson = (events) => events.map((e) => JSON.stringify(e)).join('\n') + '\n'
const scanOk = (events) => new Response(ndjson(events), { status: 200, headers: { 'content-type': 'application/x-ndjson' } })

/** A fake Lychgate. `scans` maps repo -> events | Response | function. */
function fakeLychgate(scans, { report = () => Response.json({ id: 'abc234abc234', path: '/r/abc234abc234' }, { status: 201 }) } = {}) {
  const calls = []
  const fetch = async (url, init = {}) => {
    const u = new URL(url)
    calls.push({ url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : undefined, redirect: init.redirect })
    if (u.origin !== LYCH) throw new Error('unexpected host ' + u.origin)
    if (u.pathname === '/api/scan') {
      const { repo } = JSON.parse(init.body)
      const s = scans[repo]
      if (typeof s === 'function') return s()
      if (s instanceof Response) return s
      if (!s) return Response.json({ error: 'No Markdown files found in that repo.' }, { status: 200 })
      return scanOk(s)
    }
    if (u.pathname === '/api/report') return report(JSON.parse(init.body))
    return new Response('nope', { status: 404 })
  }
  return { fetch, calls }
}

const quiet = () => {}
const baseOpts = (root, fk, extra = {}) => ({ root, fetch: fk.fetch, sleep: async () => {}, now: () => new Date('2026-12-01T09:00:00Z'), log: quiet, spacingMs: 0, ...extra })
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'))
const exists = (p) => stat(p).then(() => true, () => false)

// ---------- validation ----------

test('validateRepo accepts owner/repo and rejects the rest', () => {
  for (const ok of ['facebook/react', 'a/b', 'my-org/my.repo_name-1', 'MDN/content']) assert.equal(validateRepo(ok), true, ok)
  for (const bad of ['react', 'a/b/c', '/b', 'a/', 'a/..', 'a/.', '-a/b', 'a-/b' + 'x'.repeat(101), 'a b/c', 'https://github.com/a/b', 'a/b?x=1', 'a/b;rm', '', null, 42, 'a'.repeat(40) + '/b'])
    assert.equal(validateRepo(bad), false, String(bad))
})

test('loadWatchlist caps at 10 repos, dedupes and warns', async () => {
  const repos = Array.from({ length: 12 }, (_, i) => `org/r${i}`).concat(['org/r0'])
  const root = await makeRoot({ lychgate: LYCH, repos })
  const wl = await loadWatchlist(root)
  assert.equal(wl.repos.length, 10)
  assert.ok(wl.warnings.some((w) => /10/.test(w)))
})

test('loadWatchlist rejects invalid repos, bad JSON and non-https hosts', async () => {
  const bad = await makeRoot({ lychgate: LYCH, repos: ['good/one', 'not a repo'] })
  const wl = await loadWatchlist(bad)
  assert.deepEqual(wl.repos, ['good/one'])
  assert.ok(wl.warnings.some((w) => /not a repo/.test(w)))

  const http = await makeRoot({ lychgate: 'http://evil.example', repos: ['a/b'] })
  await assert.rejects(loadWatchlist(http), /https/)
  const loop = await makeRoot({ lychgate: 'http://127.0.0.1:4000', repos: ['a/b'] })
  assert.equal((await loadWatchlist(loop)).lychgate, 'http://127.0.0.1:4000')
  const creds = await makeRoot({ lychgate: 'https://user:pw@x.example', repos: ['a/b'] })
  await assert.rejects(loadWatchlist(creds), /credentials|host/i)

  const junk = await mkdtemp(path.join(tmpdir(), 'gk-'))
  await writeFile(path.join(junk, 'watchlist.json'), '{nope')
  await assert.rejects(loadWatchlist(junk), /watchlist/)
  const none = await makeRoot({ lychgate: LYCH, repos: [] })
  await assert.rejects(loadWatchlist(none), /no repos|empty/i)
})

test('default lychgate host applies when omitted', async () => {
  const root = await makeRoot({ repos: ['a/b'] })
  assert.equal((await loadWatchlist(root)).lychgate, 'https://lychgate-taupe.vercel.app')
})

// ---------- a basic walk ----------

test('walk scans each repo, shares the report, records history', async () => {
  const root = await makeRoot({ lychgate: LYCH, repos: ['org/docs'] })
  const fk = fakeLychgate({
    'org/docs': [
      { type: 'status', message: 'Reading…' },
      { type: 'meta', source: 'org/docs@main', total: 3, found: 3, capped: false, docs: [], warnings: [] },
      result('https://ok.example/', 'living'),
      result('https://gone.example/a', 'tombstone', { snapshot: { timestamp: '20200101000000', url: 'https://web.archive.org/web/2020/https://gone.example/a', beforeCite: true } }),
      result('https://parked.example/', 'zombie'),
      done({ living: 1, tombstone: 1, zombie: 1, total: 3 }, 33),
    ],
  })
  const out = await walk(baseOpts(root, fk))

  const scan = fk.calls.find((c) => c.url.endsWith('/api/scan'))
  assert.deepEqual(scan.body, { kind: 'github', repo: 'org/docs' })
  assert.equal(scan.method, 'POST')
  assert.equal(scan.redirect, 'error')

  const share = fk.calls.find((c) => c.url.endsWith('/api/report'))
  assert.equal(share.body.source, 'org/docs@main')
  assert.equal(share.body.results.length, 3)
  assert.equal('redirects' in share.body.results[0], false)
  assert.equal('ms' in share.body.results[0], false)

  const walks = await readJson(path.join(root, 'data', 'walks.json'))
  assert.equal(walks.version, 1)
  assert.equal(walks.entries.length, 1)
  const e = walks.entries[0]
  assert.equal(e.repo, 'org/docs')
  assert.equal(e.at, '2026-12-01T09:00:00.000Z')
  assert.equal(e.health, 33)
  assert.equal(e.counts.tombstone, 1)
  assert.equal(e.counts.total, 3)
  assert.equal(e.reportUrl, `${LYCH}/r/abc234abc234`)
  assert.deepEqual(e.graves.map((g) => [g.url, g.cls]), [['https://gone.example/a', 'tombstone'], ['https://parked.example/', 'zombie']])
  assert.equal(e.graves[0].snapshot.url, 'https://web.archive.org/web/2020/https://gone.example/a')
  assert.equal(e.graves[1].snapshot, null)
  assert.deepEqual(e.graves[0].where, ['README.md:3'])
  assert.equal(out.entries.length, 1)
})

test('first walk of a repo is a baseline: no report file', async () => {
  const root = await makeRoot({ lychgate: LYCH, repos: ['org/docs'] })
  const fk = fakeLychgate({ 'org/docs': [result('https://gone/', 'tombstone'), done({ tombstone: 1, total: 1 }, 0)] })
  const out = await walk(baseOpts(root, fk))
  assert.equal(out.reportWritten, false)
  assert.equal(await exists(path.join(root, 'data', 'latest-report.md')), false)
})

test('NDJSON split across chunks is parsed', async () => {
  const root = await makeRoot({ lychgate: LYCH, repos: ['org/docs'] })
  const text = ndjson([result('https://a.example/', 'living'), done({ living: 1, total: 1 }, 100)])
  const enc = new TextEncoder().encode(text)
  const stream = new ReadableStream({
    start(c) {
      for (let i = 0; i < enc.length; i += 7) c.enqueue(enc.slice(i, i + 7))
      c.close()
    },
  })
  const fk = fakeLychgate({ 'org/docs': () => new Response(stream, { status: 200 }) })
  const out = await walk(baseOpts(root, fk))
  assert.equal(out.entries[0].health, 100)
})

// ---------- spacing and rate limit ----------

test('scans are spaced by spacingMs, not before the first or after the last', async () => {
  const root = await makeRoot({ lychgate: LYCH, repos: ['a/one', 'a/two', 'a/three'] })
  const ok = () => scanOk([result('https://x/', 'living'), done({ living: 1, total: 1 }, 100)])
  const fk = fakeLychgate({ 'a/one': ok, 'a/two': ok, 'a/three': ok })
  const sleeps = []
  await walk(baseOpts(root, fk, { spacingMs: 100_000, sleep: async (ms) => sleeps.push(ms) }))
  assert.deepEqual(sleeps, [100_000, 100_000])
})

test('default spacing is at least 100 seconds', async () => {
  const root = await makeRoot({ lychgate: LYCH, repos: ['a/one', 'a/two'] })
  const ok = () => scanOk([done({ total: 0 }, 100)])
  const fk = fakeLychgate({ 'a/one': ok, 'a/two': ok })
  const sleeps = []
  const o = baseOpts(root, fk, { sleep: async (ms) => sleeps.push(ms) })
  delete o.spacingMs
  await walk(o)
  assert.ok(sleeps[0] >= 100_000)
})

test('429 stops the walk, keeps finished repos, reports when to retry', async () => {
  const root = await makeRoot({ lychgate: LYCH, repos: ['a/one', 'a/two', 'a/three'] })
  const fk = fakeLychgate({
    'a/one': [result('https://x/', 'living'), done({ living: 1, total: 1 }, 100)],
    'a/two': () => Response.json({ error: 'Too many scans. Try again in 412s.' }, { status: 429, headers: { 'retry-after': '412' } }),
    'a/three': [done({ total: 0 }, 100)],
  })
  const out = await walk(baseOpts(root, fk))
  assert.equal(out.rateLimited.retryAfterS, 412)
  assert.equal(out.rateLimited.repo, 'a/two')
  assert.equal(out.entries.length, 1)
  assert.equal(fk.calls.filter((c) => c.url.endsWith('/api/scan')).length, 2)
  const walks = await readJson(path.join(root, 'data', 'walks.json'))
  assert.deepEqual(walks.entries.map((e) => e.repo), ['a/one'])
})

test('429 without retry-after still stops and parses seconds from the body', async () => {
  const root = await makeRoot({ lychgate: LYCH, repos: ['a/one', 'a/two'] })
  const fk = fakeLychgate({ 'a/one': () => Response.json({ error: 'Too many scans. Try again in 77s.' }, { status: 429 }) })
  const out = await walk(baseOpts(root, fk))
  assert.equal(out.rateLimited.retryAfterS, 77)
  assert.equal(fk.calls.length, 1)
})

// ---------- failures ----------

test('a failed repo is reported and skipped; the walk continues', async () => {
  const root = await makeRoot({ lychgate: LYCH, repos: ['a/bad', 'a/err', 'a/cut', 'a/net', 'a/good'] })
  const fk = fakeLychgate({
    'a/bad': () => new Response('boom', { status: 500 }),
    'a/err': [{ type: 'error', message: 'No Markdown files found in that repo.' }],
    'a/cut': [result('https://x/', 'living')],
    'a/net': () => { throw new Error('socket hang up') },
    'a/good': [result('https://x/', 'living'), done({ living: 1, total: 1 }, 100)],
  })
  const out = await walk(baseOpts(root, fk))
  assert.deepEqual(out.failures.map((f) => f.repo), ['a/bad', 'a/err', 'a/cut', 'a/net'])
  assert.match(out.failures[1].message, /No Markdown/)
  assert.deepEqual(out.entries.map((e) => e.repo), ['a/good'])
})

test('zero results or a failed share leaves reportUrl null', async () => {
  const root = await makeRoot({ lychgate: LYCH, repos: ['a/empty', 'a/noshare'] })
  const fk = fakeLychgate(
    {
      'a/empty': [done({ total: 0 }, 100)],
      'a/noshare': [result('https://x/', 'living'), done({ living: 1, total: 1 }, 100)],
    },
    { report: () => Response.json({ error: 'Sharing is not configured on this deployment.' }, { status: 503 }) },
  )
  const out = await walk(baseOpts(root, fk))
  assert.equal(fk.calls.filter((c) => c.url.endsWith('/api/report')).length, 1)
  assert.deepEqual(out.entries.map((e) => e.reportUrl), [null, null])
})

test('a 429 on /api/report does not stop the walk', async () => {
  const root = await makeRoot({ lychgate: LYCH, repos: ['a/one', 'a/two'] })
  const ok = [result('https://x/', 'living'), done({ living: 1, total: 1 }, 100)]
  const fk = fakeLychgate({ 'a/one': ok, 'a/two': ok }, { report: () => new Response('{}', { status: 429 }) })
  const out = await walk(baseOpts(root, fk))
  assert.equal(out.entries.length, 2)
  assert.equal(out.rateLimited, null)
})

// ---------- comparison and report ----------

const prevEntry = (over = {}) => ({
  repo: 'org/docs', at: '2026-11-24T09:00:00.000Z', health: 90,
  counts: { living: 9, tombstone: 1, ghost: 0, drifted: 0, zombie: 0, restless: 0, sealed: 0, total: 10 },
  reportUrl: `${LYCH}/r/old`, graves: [{ url: 'https://old-grave.example/', cls: 'tombstone', snapshot: null, where: ['README.md:1'] }], ...over,
})

test('a new grave writes latest-report.md with snapshot and PR description', async () => {
  const root = await makeRoot({ lychgate: LYCH, repos: ['org/docs'] }, { version: 1, entries: [prevEntry()] })
  const fk = fakeLychgate({
    'org/docs': [
      result('https://old-grave.example/', 'tombstone'),
      result('https://new-grave.example/page', 'ghost', {
        occurrences: [{ doc: 'docs/intro.md', line: 42 }],
        snapshot: { timestamp: '20240101000000', url: 'https://web.archive.org/web/20240101000000/https://new-grave.example/page', beforeCite: true },
      }),
      result('https://parked.example/', 'zombie'),
      done({ living: 8, tombstone: 1, ghost: 1, zombie: 1, total: 11 }, 73),
    ],
  })
  const out = await walk(baseOpts(root, fk))
  assert.equal(out.reportWritten, true)
  const md = await readFile(path.join(root, 'data', 'latest-report.md'), 'utf8')
  assert.match(md, /org\/docs/)
  assert.match(md, /90.*73/s)
  assert.match(md, /https:\/\/new-grave\.example\/page/)
  assert.match(md, /Ghost/i)
  assert.match(md, /docs\/intro\.md:42/)
  assert.match(md, /web\.archive\.org\/web\/20240101000000/)
  assert.match(md, /https:\/\/parked\.example\//)
  assert.match(md, /Pull request description/i)
  assert.match(md, /r\/abc234abc234/)
  // the grave that was already known is not listed as new
  assert.equal(md.includes('old-grave.example'), false)
})

test('a health drop with no new grave still writes a report', async () => {
  const root = await makeRoot({ lychgate: LYCH, repos: ['org/docs'] }, { version: 1, entries: [prevEntry()] })
  const fk = fakeLychgate({
    'org/docs': [result('https://old-grave.example/', 'tombstone'), result('https://d.example/', 'drifted'), done({ living: 7, tombstone: 1, drifted: 2, total: 10 }, 80)],
  })
  const out = await walk(baseOpts(root, fk))
  assert.equal(out.reportWritten, true)
  assert.match(await readFile(path.join(root, 'data', 'latest-report.md'), 'utf8'), /90.*80/s)
})

test('same or better health with no new grave writes no report and removes a stale one', async () => {
  const root = await makeRoot({ lychgate: LYCH, repos: ['org/docs'] }, { version: 1, entries: [prevEntry()] })
  await writeFile(path.join(root, 'data', 'latest-report.md'), 'stale')
  const fk = fakeLychgate({ 'org/docs': [result('https://old-grave.example/', 'tombstone'), done({ living: 9, tombstone: 1, total: 10 }, 95)] })
  const out = await walk(baseOpts(root, fk))
  assert.equal(out.reportWritten, false)
  assert.equal(await exists(path.join(root, 'data', 'latest-report.md')), false)
})

test('history is appended per repo and capped at 52 entries per repo', async () => {
  const entries = Array.from({ length: 52 }, (_, i) => prevEntry({ at: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`, health: 100, graves: [], reportUrl: null, n: i }))
  const root = await makeRoot({ lychgate: LYCH, repos: ['org/docs'] }, { version: 1, entries })
  const fk = fakeLychgate({ 'org/docs': [done({ living: 1, total: 1 }, 100), ] })
  await walk(baseOpts(root, fk))
  const walks = await readJson(path.join(root, 'data', 'walks.json'))
  assert.equal(walks.entries.length, 52)
  assert.equal(walks.entries.at(-1).at, '2026-12-01T09:00:00.000Z')
  assert.equal(walks.entries[0].n, 1)
})

test('history of repos no longer watched is kept', async () => {
  const other = prevEntry({ repo: 'old/repo' })
  const root = await makeRoot({ lychgate: LYCH, repos: ['org/docs'] }, { version: 1, entries: [other] })
  const fk = fakeLychgate({ 'org/docs': [done({ total: 0 }, 100)] })
  await walk(baseOpts(root, fk))
  const walks = await readJson(path.join(root, 'data', 'walks.json'))
  assert.deepEqual(walks.entries.map((e) => e.repo), ['old/repo', 'org/docs'])
})

test('a corrupt walks.json stops the walk without overwriting it', async () => {
  const root = await makeRoot({ lychgate: LYCH, repos: ['org/docs'] })
  await mkdir(path.join(root, 'data'), { recursive: true })
  await writeFile(path.join(root, 'data', 'walks.json'), '{broken')
  const fk = fakeLychgate({ 'org/docs': [done({ total: 0 }, 100)] })
  await assert.rejects(walk(baseOpts(root, fk)), /walks\.json/)
  assert.equal(await readFile(path.join(root, 'data', 'walks.json'), 'utf8'), '{broken')
  assert.equal(fk.calls.length, 0)
})

// ---------- safety ----------

test('only the configured lychgate origin is contacted, and only /api/scan and /api/report', async () => {
  const root = await makeRoot({ lychgate: LYCH, repos: ['a/one', 'a/two'] })
  const ok = [result('https://x/', 'living'), done({ living: 1, total: 1 }, 100)]
  const fk = fakeLychgate({ 'a/one': ok, 'a/two': ok })
  await walk(baseOpts(root, fk))
  for (const c of fk.calls) {
    const u = new URL(c.url)
    assert.equal(u.origin, LYCH)
    assert.ok(['/api/scan', '/api/report'].includes(u.pathname))
    assert.equal(c.method, 'POST')
  }
})

test('toShared trims to the report schema', () => {
  const long = 'x'.repeat(500)
  const s = toShared({
    url: 'https://a/', cls: 'ghost', confidence: 0.5, reasons: Array(12).fill(long), redirects: [1], ms: 4, title: long,
    occurrences: Array.from({ length: 30 }, (_, i) => ({ doc: 'd', line: i })),
  })
  assert.equal(s.reasons.length, 8)
  assert.equal(s.reasons[0].length, 400)
  assert.equal(s.title.length, 200)
  assert.equal(s.occurrences.length, 20)
  assert.equal('redirects' in s, false)
  assert.equal('ms' in s, false)
})
