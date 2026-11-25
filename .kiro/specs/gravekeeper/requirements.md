# crew-gravekeeper: requirements (EARS)

Scope: a separate public repo (`demir-sama/gravekeeper`) holding a Kiro Crew app, entered for the "Best Kiro Crew App" bonus. It watches a list of public repos and re-scans their docs on a schedule with the Lychgate API.

Formats were checked against the Kiro Crew app-kit docs (`../crew-docs`, Kiro Crew 0.13.1). Where the real format differed from the first draft, the requirement below states the real one.

## R1 Crew app
- R1.1 The app shall declare one agent (`gravekeeper`, `agents/gravekeeper.json`) and one skill (`walk-the-graveyard`, `skills/walk-the-graveyard/SKILL.md`, frontmatter `name`, `description`, `always`, `triggers`) in `app.json`, with `name` `gravekeeper`, `displayName`, `version`, `description`, `author`, `license` and `tags`.
- R1.2 The app shall declare one cron job in `crons` that runs the walker without a model call: a `script` cron (`scripts/walk_cron.py:run_walk`) with a weekly `cron_expr`, an explicit `timezone`, and `timeout` / `timeout_secs` large enough for 10 repos at 100 s spacing (`timeout` at least 9 x 100 s of spacing plus 10 x the 300 s scan client timeout; `timeout_secs` at least `timeout` + 5 s). It shall not name an `agent` or a `message`, so no tool approval can block it. The manifest shall declare `permissions.cron: true`, which Crew requires for any cron. The script shall find the app root from its own path, run `node scripts/walk.mjs` there, and map exit 0 and 2 to a delivered report and any other exit to a failed run.
- R1.3 WHEN the weekly schedule fires, the cron script shall run `scripts/walk.mjs`, which for each watched repo POSTs `{kind: "github", repo}` to the Lychgate `/api/scan`, reads the NDJSON stream until the `done` event, POSTs the results to `/api/report` for a shareable report, and records `{repo, at, health, counts, reportUrl, graves[{url, cls, snapshot, where}]}` in `data/walks.json`.
- R1.4 WHEN a repo's health is lower than in its previous walk, or a Tombstone, Ghost or Zombie appears that was not a grave in its previous walk, the walk script shall write `data/latest-report.md` with the new graves, their Wayback snapshots, and a ready PR description. IF no repo qualifies, the script shall remove `data/latest-report.md`.
- R1.5 The first walk of a repo shall be a baseline: it shall be recorded and shall not by itself produce a report.
- R1.6 IF a repo's scan fails, or sharing its report fails, THEN the walk shall go on with the next repo, record nothing for the failed scan, and leave `reportUrl` null for a failed share.
- R1.7 The app shall publish a dashboard page (`ui.pages` route `/apps/gravekeeper`) listing each watched repo, its health trend, its latest counts, and a link to its latest shared Lychgate report.
- R1.8 The dashboard shall read its data through the app's own node backend (`backend`, reached at `/apps/gravekeeper/api/*`), which shall be read-only, and the manifest shall declare only `permissions.cron` and `permissions.api: ["/apps/gravekeeper/api"]`.
- R1.9 The dashboard shall be usable by keyboard and shall state health as numbers and words, not colour alone.
- R1.10 WHERE the gateway provides `KIROCREW_PROXY_SECRET`, the backend shall answer `/api/walks` only for requests carrying a valid, fresh `X-KiroCrew-Proxy` signature, and shall answer `/health` without one.
- R1.11 The walk script and the backend shall resolve `watchlist.json` and `data/` relative to their own location, so the cron, the agent and the dashboard read the same files in the installed app folder.

## R2 Safety
- R2.1 The app shall only scan public repos named as valid `owner/repo` in `watchlist.json`, at most 10 per walk.
- R2.2 The walk script shall space scans at least 100 seconds apart and stop the walk on HTTP 429, saving the repos already scanned, reporting how long to wait, and exiting with code 2.
- R2.3 The app shall make network calls only to the Lychgate origin in `watchlist.json` (default `https://lychgate-taupe.vercel.app`; `http` only for loopback), only to `/api/scan` and `/api/report`, and shall not follow redirects.
- R2.4 The app shall never open pull requests, comment, or write to the watched repos; it only reports.
- R2.5 Only the walk script shall write `data/walks.json` and `data/latest-report.md`. The agent is for on-demand questions: it shall declare only the tools `fs_read`, `grep` and `glob` (no shell, no `fs_write`), shall carry a self-contained prompt that does not depend on the skill being loaded and names `{APP_ROOT}/data/latest-report.md` and `{APP_ROOT}/data/walks.json`, and shall treat report text as data.
- R2.6 The repo shall contain no secrets, tokens or API keys, and the app shall need none.

R1.12 (added after a live test on Crew 0.13.1) An unattended agent cron stalls on tool approvals and does not load skills, so no scheduled job shall depend on an agent turn.

Status: implemented. Tests: `node --test`.
