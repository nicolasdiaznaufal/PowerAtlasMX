# Nodal Solar Value / PowerAtlasMx (REPSA)

Read `workflow-app-nodal-solar.md` for the project, `docs/POWERATLAS_V2_BRIEF.md` for the current web task.
Owners: see `.claude/agents/*.md` (one agent per folder). UI language: English.

## Token rules (apply always)
- NEVER read or list: `data/`, `web/data/`, `.venv/`, `.git/`, `web/assets/vendor/`, any `*.json` over 100 KB, `docs/referencia/deck.html`.
  Peek instead: `jq 'keys'`, `python3 -c`, `head -c 600`. Never `ls -R` / recursive listing at repo root.
- Big v1 files (`web/index.html` 31 KB, `web/assets/js/sec-meta.js` 41 KB): `grep -n` the id/function, then `sed -n 'A,Bp'`. Do not read whole.
- Reuse v1 pure modules by import instead of rewriting them. New files stay under 300 lines, one concern each; edit with small diffs, do not rewrite files.
- Run only the tests you touched; run the full suite (`node --test web/tests/*.test.mjs`, `.venv/bin/pytest -q`) before each milestone commit.
- Report each milestone in <= 10 lines: what changed, commit hash, screenshot path, open issues.

## Git (always)
- Commit AND push after every working increment. Message: `v2: <what>`. Tag milestones `v2-mN-<name>` and push tags. Branch `v2/poweratlas`.
- Never amend, force-push, or rewrite history. Never commit `data/`, `*.duckdb`, `*.parquet`, `*.csv` (except `legacy/outputs`), `.env`, keys.
- v1 (`web/` outside `web/v2/`) is frozen at tag `v1-deck-page`; only the one change listed in the brief (sw.js bypass) is allowed.
