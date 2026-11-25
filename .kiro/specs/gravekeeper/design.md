# Gravekeeper: design

Formats below were checked against `../crew-docs` (manifest-reference, getting-started, api-reference) and the Lychgate source (`app/api/scan/route.ts`, `app/api/report/route.ts`, `lib/scan/{input,types,engine}.ts`, `lib/report/report.ts`).

## Layout

```
app.json                 manifest (1 agent, 1 skill, 1 weekly script cron, 1 UI page, node backend)
agents/gravekeeper.json  the Gravekeeper agent (on-demand questions; fs_read, grep, glob)
skills/walk-the-graveyard/SKILL.md
scripts/walk_cron.py     cron entry: runs walk.mjs in the app root, maps its exit code
scripts/walk.mjs         deterministic walker (Node 22+, no dependencies); the only writer of data/
backend/server.mjs       read-only JSON endpoint for the dashboard (Node, no dependencies)
ui/src/App.tsx           dashboard page, built to ui/dist/index.mjs
watchlist.json           {lychgate, repos[]}
data/walks.json          history (written by walk.mjs)
data/latest-report.md    present only when the latest walk found something new
test/*.test.mjs          node:test, mocked fetch, no network
```

## Crew format decisions

- **Cron:** a `script` cron, `{name, cron_expr: "0 9 * * 1", timezone: "UTC", script: "scripts/walk_cron.py:run_walk", timeout: 4500, timeout_secs: 4510}`. It replaces the first design (an agent cron with a `message`): a live test on Kiro Crew 0.13.1 showed the unattended agent session waits on tool approvals nobody gives and does not load the skill. `permissions.cron: true` is still required.
  - Why `script`, not `command` (checked in `kiro_crew/cron_script.py`, `cron_exec.py`, `apps/bridges_crons.py`, `mcp_cron_vet.py` and by running Crew's `run_command_sandboxed` / `run_script_sandboxed` here): a `command` runs via `sh -c` in the gateway's working directory (observed `/tmp`), `{APP_ROOT}` is substituted only in agent JSON, not in commands, no app-root env var is set, `KIROCREW*` names in `env` are dropped, and command substitution (`$(...)`) and `${X:-d}` are refused at vet time. A command could only hard-code the install path. A `script` path resolves against the app bundle, so `walk_cron.py` derives the root from `__file__`, runs `node scripts/walk.mjs` with `cwd` = the app root, and `data/` is writable there. Both kinds run in the `cc` sandbox: network allowed, `node` on `PATH`, no credential dirs.
  - Timeouts: `timeout` bounds the subprocess (script default 30 s, command default 300 s), `timeout_secs` the whole run and must be at least `timeout` + 5 s. Worst case is 9 gaps x 100 s + 10 scans x 300 s client timeout = 3900 s, so `timeout` is 4500 and `timeout_secs` 4510 (limit 86400). Normal runs take about 15 minutes.
  - Result delivery: exit 0 and exit 2 (HTTP 429, history saved) raise `Report(text)`, which delivers the text and keeps the job. `Done` is not used because it removes the job from the schedule. Any other exit raises `RuntimeError` so the run shows as failed.
  - Crew applies a changed `script` only when the job is recreated, so an installed 0.1.0 needs disable then enable once.
- **Agent:** `{name, model, description, prompt, tools}`, for on-demand questions only. Tools are `fs_read`, `grep`, `glob`: no shell, no write. The prompt is self-contained (classes, file formats, rules) and reads `{APP_ROOT}/data/latest-report.md`, `{APP_ROOT}/data/walks.json` and `{APP_ROOT}/watchlist.json` (`{APP_ROOT}` is the documented placeholder, filled in at registration). It does not rely on the skill.
- **Skill:** `skills/walk-the-graveyard/SKILL.md` with frontmatter `name` (equal to the directory), `description`, `always: false` and comma-separated `triggers`, the shape Crew's built-in app skills use. It explains how to read the result; it does not run the walker.
- **Dashboard data:** the UI sandbox only reaches `permissions.api` paths. Apps have no documented file-read API for pages, so the smallest documented route is a process backend (`backend.type: "node"`) reached through the reverse proxy at `/apps/gravekeeper/api/*`. The UI declares `permissions.api: ["/apps/gravekeeper/api"]`. The backend binds `127.0.0.1:$PORT`, serves `GET /health` and `GET /api/walks`, verifies the `X-KiroCrew-Proxy` v1 HMAC when `KIROCREW_PROXY_SECRET` is set, and never writes.
- **Paths:** `walk.mjs` and the backend resolve `watchlist.json` and `data/` relative to their own file, so the cron, the agent and the backend agree whatever the working directory is. `GRAVEKEEPER_DATA_DIR` overrides the data directory (tests).

## Walker (`scripts/walk.mjs`)

Exports `walk(opts)` and runs as a CLI when executed directly. `opts`: `root`, `fetch`, `sleep`, `now`, `spacingMs` (default 100000), `log`.

1. Load and validate `watchlist.json`.
   - `lychgate` must be `https://` (or `http://` on loopback, for tests). Calls go to that origin only, with `redirect: "error"`.
   - Each repo must match `owner/repo` (owner: letters, digits, hyphen, up to 39 chars; repo: letters, digits, `.`, `_`, `-`, up to 100 chars, not `.` or `..`). Duplicates are dropped. Anything past 10 valid repos is skipped with a warning.
2. For each repo, in order, `POST <lychgate>/api/scan` with `{kind:"github", repo}`.
   - Between scans wait `spacingMs` (100 s by default, 6 scans per 10 minutes is Lychgate's limit).
   - HTTP 429 stops the walk. The repos already finished are saved, and the output says when to retry (`retry-after` header, else the body text).
   - Other HTTP errors, an `error` event, or a stream that ends without `done` mark that repo failed. Nothing is recorded for it, and the walk goes on.
   - The NDJSON stream is read line by line. `result` events are collected, `done` carries `summary`. A scan has a 5 minute client timeout.
3. Share: `POST <lychgate>/api/report` with `{source, results}` where each result is trimmed to the shared-report schema (`toShared`: no redirect hops, no timings, strings cut to the schema limits, at most 300 results). Reply `201 {id, path}` gives `reportUrl = <lychgate><path>`. A failed share (503 not configured, 429, any error, zero results) leaves `reportUrl: null` and does not fail the repo.
4. Record `{repo, at, health, counts, reportUrl, graves}` in `data/walks.json`.
   - `counts` is the per-class tally plus `total`.
   - `graves` holds each Tombstone, Ghost and Zombie: `{url, cls, snapshot, where}`. `snapshot` is Lychgate's `{timestamp, url, beforeCite}` or `null`. `where` lists up to 3 `doc:line` places.
   - File shape: `{"version":1,"entries":[...]}`, newest last, at most 52 entries per repo. It is written to a temp file and renamed.
5. Compare with the previous entry for the same repo. A repo needs a report when `health` fell, or a grave URL is present that was not a grave in the previous entry. A first-ever entry has nothing to compare with, so it is a baseline and never triggers a report.
6. If any repo needs a report, write `data/latest-report.md`: a header with the walk time, one section per repo (health before and after, new graves with class, location, snapshot, a ready PR description in a fenced block). If none does, delete `data/latest-report.md` so its presence always means "this walk found something".
7. Print a short summary to stdout (one line per repo, whether a report was written, retry time on 429). Exit codes: `0` finished, `2` stopped by 429, `1` bad config or nothing could be scanned.

The PR description is text only. Nothing in this app calls the GitHub API or any host other than the configured Lychgate origin.

## Backend (`backend/server.mjs`)

`createServer({root, secret, now})` returns a `node:http` server. `GET /health` returns 200 with no auth (the gateway probe is unsigned). `GET /api/walks` returns `{repos:[{repo, latest, history:[{at, health}]}], lychgate, reportAt}` built from `watchlist.json` and `data/walks.json`, with repos in the watch list but never walked shown as empty. Other methods and paths get 405/404.

## Dashboard (`ui/src/App.tsx`)

`useAppApi().get('/apps/gravekeeper/api/walks')`. One card per watched repo: name, latest health, trend sparkline (inline SVG with a text alternative), per-class counts, grave count, link to the latest shared Lychgate report, and "not walked yet" when there is no history. Plain semantic HTML with focus-visible rings, so tab order follows the cards and links. Dark, candle-amber palette; text always states the numbers so colour is never the only signal. Built with the scaffold's vite config to `ui/dist/index.mjs`.

## Tests

`test/walk.test.mjs` (written first): validation, cap, spacing, NDJSON parsing incl. split chunks, 429 stop, failed repo, share failure, history, comparison rules, report content, stale report deletion. `test/backend.test.mjs`: endpoint shape, HMAC check, read-only. `test/manifest.test.mjs`: manifest invariants (agent prompt and tools, skill frontmatter, script-cron shape and timeout arithmetic, permissions, no secrets).
