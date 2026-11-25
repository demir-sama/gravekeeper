# Gravekeeper: tasks

- [x] 1. Read requirements and steering; check Crew formats in `../crew-docs`
- [x] 2. Write design.md and tasks.md; update requirements.md to the real Crew format
- [x] 3. Tests first: `test/walk.test.mjs` (mocked fetch, no network)
- [x] 4. `scripts/walk.mjs` until the walk tests pass
- [x] 5. Tests first, then `backend/server.mjs` (`test/backend.test.mjs`)
- [x] 6. `app.json`, `agents/gravekeeper.json`, `skills/walk-the-graveyard/SKILL.md`; remove the sample agent and skill; `test/manifest.test.mjs`
- [x] 7. `watchlist.json` seed (3 public doc-heavy repos)
- [x] 8. Dashboard `ui/src/App.tsx`; `npm install`, `npm run build`
- [x] 9. README.md
- [x] 10. Verify: `node --test`, UI build, `kirocrew app install` then uninstall
- [x] 11. Live-test fix (Crew 0.13.1): agent cron stalled on approvals and skipped the skill. Tests first (`test/manifest.test.mjs`: script-cron shape, timeouts, self-contained read-only agent, skill frontmatter), then `scripts/walk_cron.py`, `app.json` cron, agent prompt and tools, SKILL.md, README, specs
- [x] 12. Verify: `node --test`; `AppManifest.validate` returns no errors; Crew's script vet accepts `walk_cron.py`; `run_script_sandboxed` against a stub app tree under `~/.kiro/crew/apps` for exit 0, 2 and 1
