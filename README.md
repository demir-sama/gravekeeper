# Gravekeeper

Gravekeeper is a Kiro Crew app that keeps watch over the docs of public GitHub repos. Once a week it walks the graveyard: it asks the public [Lychgate](https://lychgate-taupe.vercel.app) scanner to check every Markdown link in each watched repo, saves the result, and writes a short report when a repo's health drops or new dead links appear. The report has Wayback Machine snapshots and a ready-to-paste PR description.

It only reports. It never opens pull requests, comments, or writes to the repos it watches.

## What you get

- A weekly cron (Mondays 09:00 UTC) that runs the walker directly: a Crew `script` cron, no model call and no approvals.
- A read-only Gravekeeper agent you can ask what the last walk found.
- A dashboard page at `/apps/gravekeeper`: one card per watched repo with its health score, a trend sparkline, per-class counts (Living, Tombstone, Ghost, Zombie, Drifted), the list of graves, and a link to the latest shared Lychgate report.
- `data/walks.json` (history) and `data/latest-report.md` (only present when the latest walk found something new).

Graves are links Lychgate classes as Tombstone (the page is gone), Ghost (it leads nowhere real) or Zombie (the address answers with something else, such as a parked domain).

## Install

Requires Kiro Crew 0.13 or later and Node.js 22+.

```bash
kirocrew app install /path/to/gravekeeper      # a local folder
# or
kirocrew app install https://github.com/demir-sama/gravekeeper.git
kirocrew app enable gravekeeper
```

Crew asks you to trust a third-party app before it enables it (see the Crew docs, "Third-party apps"). The dashboard build (`ui/dist/index.mjs`) is part of the repo. To rebuild it: `cd ui && npm install && npm run build`.

## Configure `watchlist.json`

```json
{
  "lychgate": "https://lychgate-taupe.vercel.app",
  "repos": ["rust-lang/book", "sindresorhus/awesome", "jlevy/the-art-of-command-line"]
}
```

- `repos`: public GitHub repos as `owner/repo`. At most 10 are walked per run; invalid names are skipped with a warning.
- `lychgate`: the scanner to call. It must be `https` (`http` is allowed only for `localhost`) and defaults to the public instance.

Edit the file in the installed app folder (`~/.kiro/crew/apps/gravekeeper/watchlist.json`). An app update replaces that file, so keep a copy of your list.

## How a walk works

1. The cron runs `scripts/walk_cron.py`, which starts `node scripts/walk.mjs` in the app folder (it finds the app root from its own path) and reports the walker's summary. Nothing waits on an approval. To walk on demand, use the job's run-now control on the Schedule page, or run `node scripts/walk.mjs` yourself.
2. For each repo, the script POSTs `{kind: "github", repo}` to Lychgate's `/api/scan` and reads the NDJSON stream until the `done` event.
3. It POSTs the results to `/api/report` to get a shareable report link. If sharing fails, the walk goes on and `reportUrl` stays `null`.
4. It appends `{repo, at, health, counts, reportUrl, graves}` to `data/walks.json` (the last 52 walks per repo).
5. It compares with the repo's previous walk. If health dropped, or a Tombstone, Ghost or Zombie appeared that was not a grave before, it writes `data/latest-report.md` with the new graves, their Wayback snapshots and a PR description. Otherwise it deletes that file, so its presence means "this walk found something". A repo's first walk is a baseline and never triggers a report.
6. Ask the Gravekeeper agent about the result. It reads `data/latest-report.md` and `data/walks.json` and summarises them.

Scans are spaced 100 seconds apart, so ten repos take about 15 minutes (the cron allows up to 75 minutes: `timeout` 4500 s, `timeout_secs` 4510 s). If Lychgate answers HTTP 429 the walk stops, keeps what it has, says how long to wait, and exits with code 2. A repo whose scan fails is skipped and nothing is recorded for it.

You can run the walker yourself: `node scripts/walk.mjs` (exit codes: 0 done, 1 bad config or nothing scanned, 2 stopped by a 429).

## Safety

- Only repos in `watchlist.json`, at most 10 per walk, public repos only.
- Network calls go only to the configured Lychgate host, only to `/api/scan` and `/api/report`, with redirects refused. Lychgate's limit is 6 scans per 10 minutes per IP; the spacing and the stop on 429 respect it.
- Read-only towards watched repos. No pull requests, comments or pushes.
- Only the walk script writes `data/`. The agent has the tools `fs_read`, `grep` and `glob` only (no shell, no file-write tool), and treats report text as data from scanned documents.
- The dashboard backend (`backend/server.mjs`) is read-only, listens on loopback, and checks the gateway's `X-KiroCrew-Proxy` signature when the gateway gives it a secret. The manifest asks for only `cron` and the `/apps/gravekeeper/api` prefix.
- After updating from 0.1.0, disable and enable the app once: Crew applies a changed cron `script` only when the job is recreated.
- No secrets, tokens or API keys anywhere. Nothing paid.

## Develop

```bash
node --test          # walker, backend and manifest tests; no network
cd ui && npm install && npm run build
```

`ui/package.json` has no `@kirocrew/app-sdk` or `lucide-react` dependency: the Crew dashboard provides them at runtime.

The specs live in `.kiro/specs/gravekeeper/` (requirements, design, tasks) and the steering in `.kiro/steering/`.

## Credit

Made by Demir ([demir-sama](https://github.com/demir-sama)). Built in Kiro CLI, test-first, from the spec in `.kiro/specs/gravekeeper/`. Scanning is done by [Lychgate](https://github.com/demir-sama/lychgate).

MIT licensed.
