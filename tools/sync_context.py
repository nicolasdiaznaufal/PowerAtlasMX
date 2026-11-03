#!/usr/bin/env python3
"""Keep the AUTO block of PROJECT_CONTEXT.md in sync with the repo.

  python3 tools/sync_context.py          rewrite the AUTO block (date, tags, source fingerprint)
  python3 tools/sync_context.py --check  exit 1 if a source doc/config changed since the last sync

The narrative sections are written by hand (by Claude, per the rule in CLAUDE.md). This script only
detects staleness: the fingerprint hashes the docs and configs the narrative is derived from.
"""
import hashlib
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CTX = ROOT / "PROJECT_CONTEXT.md"
SOURCES = [
    "workflow-app-nodal-solar.md", "workflow.solar.md", "docs/TECNICO.md", "docs/POWERATLAS_V2_REPORT.md",
    "docs/POWERATLAS_V2_BRIEF.md", "docs/SOLAR_V2_PLAN.md", "docs/M18_AGENT_API.md", "docs/CORRECCIONES.md",
    "config/supuestos.yaml", "config/solar_score.json", "config/battery_score.json",
]
BEGIN, END = "<!-- AUTO:BEGIN -->", "<!-- AUTO:END -->"


def git(*a):
    return subprocess.run(["git", *a], cwd=ROOT, capture_output=True, text=True).stdout.strip()


def fingerprint():
    h = hashlib.sha1()
    for s in SOURCES:
        p = ROOT / s
        h.update(p.read_bytes() if p.exists() else b"-")
    return h.hexdigest()[:12]


def tags():
    t = git("tag", "--sort=creatordate").split()
    return [x for x in t if x.startswith("v2-")]


def block(fp):
    t = tags()
    return (f"{BEGIN}\n"
            f"- Last sync: {date.today().isoformat()} at commit `{git('rev-parse', '--short', 'HEAD')}` "
            f"(branch `{git('branch', '--show-current')}`)\n"
            f"- Latest milestone tag: `{t[-1] if t else 'none'}` ({len(t)} v2 tags)\n"
            f"- Source fingerprint: `{fp}`\n"
            f"- Milestone tags (oldest first): {', '.join(t)}\n"
            f"{END}")


def main():
    text = CTX.read_text()
    fp = fingerprint()
    m = re.search(r"Source fingerprint: `([0-9a-f]+)`", text)
    if "--check" in sys.argv:
        if m and m.group(1) == fp:
            print("PROJECT_CONTEXT.md is in sync.")
            return 0
        print("PROJECT_CONTEXT.md is STALE: update the narrative, then run tools/sync_context.py")
        return 1
    new = re.sub(re.escape(BEGIN) + r".*?" + re.escape(END), lambda _: block(fp), text, flags=re.S)
    CTX.write_text(new)
    print("synced, fingerprint", fp)
    return 0


sys.exit(main())
