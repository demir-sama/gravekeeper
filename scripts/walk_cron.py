"""Weekly cron entry for Gravekeeper: run scripts/walk.mjs itself, no model call.

Crew runs a `script` cron as a Python callable found through the app bundle, so
this file can locate the app root from its own path. (A `command` cron has no
{APP_ROOT} placeholder, an unspecified working directory and no command
substitution, so it cannot name the installed copy reliably.)

The walker is the only writer of data/. This wrapper only starts it, passes on
its output and maps its exit code:
  0  finished            -> deliver the summary (and say if a report was written)
  2  stopped by HTTP 429 -> deliver the summary; history so far is saved
  1  or anything else    -> raise, so the run shows as failed

Report (not Done) is used to deliver text: Done would remove the weekly job.
"""
import shutil
import subprocess
from pathlib import Path

from kiro_crew.cron_script import Report

ROOT = Path(__file__).resolve().parent.parent
WALKER = ROOT / "scripts" / "walk.mjs"
TAIL_CHARS = 4000


def _tail(text):
    text = (text or "").strip()
    return text if len(text) <= TAIL_CHARS else "...\n" + text[-TAIL_CHARS:]


def run_walk(ctx):
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Gravekeeper: node was not found on PATH (Node.js 22+ is required)")
    if not WALKER.is_file():
        raise RuntimeError(f"Gravekeeper: walker not found at {WALKER}")
    proc = subprocess.run(
        [node, str(WALKER)],
        cwd=str(ROOT),
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
    )
    out = _tail(proc.stdout + ("\n" + proc.stderr if proc.stderr.strip() else ""))
    if proc.returncode == 0:
        found = (ROOT / "data" / "latest-report.md").is_file()
        note = (
            "New dead links found: open data/latest-report.md or ask the Gravekeeper."
            if found
            else "The graveyard is quiet."
        )
        raise Report(f"Gravekeeper walk finished. {note}\n\n{out}")
    if proc.returncode == 2:
        raise Report(f"Gravekeeper walk stopped early by Lychgate's rate limit (HTTP 429).\n\n{out}")
    raise RuntimeError(f"Gravekeeper walk failed (exit {proc.returncode}):\n{out}")
