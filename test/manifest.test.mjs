import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readJson = async (p) => JSON.parse(await readFile(path.join(root, p), 'utf8'))
const exists = (p) => stat(path.join(root, p)).then(() => true, () => false)

test('manifest identity', async () => {
  const m = await readJson('app.json')
  assert.equal(m.name, 'gravekeeper')
  assert.match(m.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  assert.equal(m.displayName, 'Gravekeeper')
  assert.match(m.version, /^\d+\.\d+\.\d+/)
  assert.equal(m.author, 'Demir (demir-sama)')
  assert.equal(m.license, 'MIT')
  assert.ok(m.description.length > 40 && !/A Kiro Crew app:/.test(m.description))
  assert.ok(m.tags.length >= 3)
})

test('one agent and one skill, files present, sample files gone', async () => {
  const m = await readJson('app.json')
  assert.deepEqual(m.agents, ['agents/gravekeeper.json'])
  assert.deepEqual(m.skills, ['skills/walk-the-graveyard'])
  assert.equal(await exists('agents/sample-agent.json'), false)
  assert.equal(await exists('skills/sample-skill'), false)
  const agent = await readJson('agents/gravekeeper.json')
  assert.equal(agent.name, 'gravekeeper')
  assert.deepEqual(agent.tools, ['fs_read', 'grep', 'glob'], 'read-only: no shell, no write tool')
  assert.equal('allowedTools' in agent, false)
  // self-contained: does not rely on the skill being loaded, names the files it reads
  assert.doesNotMatch(agent.prompt, /load the .*skill/i)
  for (const f of ['{APP_ROOT}/data/latest-report.md', '{APP_ROOT}/data/walks.json', '{APP_ROOT}/watchlist.json']) {
    assert.ok(agent.prompt.includes(f), f)
  }
  assert.match(agent.prompt, /never open pull requests/i)
  const placeholders = agent.prompt.match(/\{[A-Z_]+\}/g) ?? []
  assert.deepEqual([...new Set(placeholders)], ['{APP_ROOT}'])
  const skill = await readFile(path.join(root, 'skills/walk-the-graveyard/SKILL.md'), 'utf8')
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(skill)
  assert.ok(fm, 'frontmatter')
  assert.match(fm[1], /^name: walk-the-graveyard$/m, 'name matches the skill directory')
  assert.match(fm[1], /^description: .{20,}/m)
  assert.match(fm[1], /^always: false$/m)
  assert.match(fm[1], /^triggers: .+/m)
  assert.match(skill, /never open/i)
})

test('weekly cron runs the walker itself: a script cron, no agent, no model', async () => {
  const m = await readJson('app.json')
  assert.equal(m.crons.length, 1)
  const c = m.crons[0]
  assert.equal(c.name, 'walk-the-graveyard')
  assert.match(c.cron_expr, /^\S+ \S+ \S+ \S+ [0-7]$/, 'weekly: one weekday field')
  assert.equal('every' in c, false)
  assert.ok(c.timezone)
  // Crew runs `script` as a bundle-relative file.py:function with the app root known to the file.
  assert.match(c.script, /^scripts\/[a-z_]+\.py:[a-z_]+$/)
  const [file, fn] = c.script.split(':')
  assert.equal(await exists(file), true)
  const py = await readFile(path.join(root, file), 'utf8')
  assert.match(py, new RegExp(`^def ${fn}\\(ctx\\):`, 'm'))
  assert.match(py, /scripts['"]? \/ ['"]walk\.mjs/, 'runs scripts/walk.mjs')
  assert.match(py, /Path\(__file__\)/, 'finds the app root from its own location')
  assert.doesNotMatch(py, /\bDone\(/, 'Done would remove the weekly job')
  // no agent turn: nothing that waits on an approval
  for (const k of ['agent', 'agent_sequence', 'message', 'command']) assert.equal(k in c, false, k)
  assert.equal(m.permissions.cron, true)
})

test('cron timeouts cover 10 repos at 100 s spacing and satisfy Crew\'s pairing rule', async () => {
  const { MAX_REPOS, SPACING_MS, SCAN_TIMEOUT_MS } = await import('../scripts/walk.mjs')
  const c = (await readJson('app.json')).crons[0]
  const spacingS = (MAX_REPOS - 1) * (SPACING_MS / 1000) // 900 s of waiting
  const scanClientTimeoutS = SCAN_TIMEOUT_MS / 1000 // walker's per-scan client timeout
  const worstCaseS = spacingS + MAX_REPOS * scanClientTimeoutS
  assert.ok(Number.isInteger(c.timeout) && c.timeout >= worstCaseS, `timeout ${c.timeout} >= ${worstCaseS}`)
  // Crew: timeout_secs must be >= timeout + 5 s cleanup, and at most 86400
  assert.ok(c.timeout_secs >= c.timeout + 5 && c.timeout_secs <= 86400, `timeout_secs ${c.timeout_secs}`)
})

test('permissions are minimal: cron plus the one API prefix the UI calls', async () => {
  const m = await readJson('app.json')
  assert.deepEqual(m.permissions, { cron: true, api: ['/apps/gravekeeper/api'] })
})

test('ui and backend entries exist', async () => {
  const m = await readJson('app.json')
  assert.equal(m.ui.entry, 'dist/index.mjs')
  assert.equal(m.ui.pages[0].route, '/apps/gravekeeper')
  assert.equal(m.backend.type, 'node')
  assert.equal(m.backend.entryPoint, 'backend/server.mjs')
  assert.equal(m.backend.healthCheck, '/health')
  assert.equal(await exists(m.backend.entryPoint), true)
  if (m.iconPath) assert.equal(await exists(m.iconPath), true)
  for (const p of [m.backend.entryPoint, ...m.agents, ...m.skills, ...(m.iconPath ? [m.iconPath] : [])]) {
    assert.ok(!path.isAbsolute(p) && !p.split('/').includes('..'), p)
  }
})

test('seed watchlist: valid public repos on the default host', async () => {
  const { validateRepo } = await import('../scripts/walk.mjs')
  const wl = await readJson('watchlist.json')
  assert.equal(wl.lychgate, 'https://lychgate-taupe.vercel.app')
  assert.equal(wl.repos.length, 3)
  for (const r of wl.repos) assert.ok(validateRepo(r), r)
})

test('no secrets or tokens in source files', async () => {
  const files = ['app.json', 'watchlist.json', 'scripts/walk.mjs', 'backend/server.mjs', 'ui/src/App.tsx', 'README.md', 'agents/gravekeeper.json', 'scripts/walk_cron.py']
  const pat = /(ghp_[A-Za-z0-9]{20,}|github_pat_|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY|postgres(ql)?:\/\/[^\s'"]*:[^\s'"]*@)/
  for (const f of files) assert.doesNotMatch(await readFile(path.join(root, f), 'utf8'), pat, f)
  assert.ok((await readdir(root)).includes('LICENSE'))
})
