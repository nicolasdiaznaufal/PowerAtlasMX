# M18 `v2-m18-agent-api`: agent-queryable data API (GOAL)

Status: planned. Owner: devops (Functions, auth) + kpis (schemas, formulas) + validador (correctness report).

## Goal
Anyone can connect their own agent framework (ChatGPT Actions, LangChain, Claude, custom) and ask
questions about **everything the site presents**: nodes, solar/battery scores, Explorer, Revenue,
Compare, scenarios, daily profiles, methodology and caveats. Model: RustGIS-style "bring your own agent".
We host data and tools, never an LLM (no inference cost).

## Scope
1. **Read-only JSON API** as Cloudflare Pages Functions under `functions/api/v1/` (same origin, same deploy).
2. **OpenAPI 3.1 spec** at `/api/v1/openapi.json` + `/llms.txt` (what exists, units, how to cite).
3. **Auth**: per-user API keys (`Authorization: Bearer`), KV-stored, revocable; the shared-password
   middleware stays for the human site. Rate limit per key. CORS limited to GET.
4. **Coverage rule**: every metric visible in the UI has an endpoint field; a test walks UI metric ids
   and fails if one has no API counterpart.
5. **Later (M18b)**: thin remote MCP server wrapping the same endpoints (tools = endpoints).

## Endpoints (v1, draft)
| Path | Returns |
|---|---|
| `GET /nodes?q=&region=&limit=` | search nodes: id, name, region (SIN/BCA/BCS), months of data, coverage flag |
| `GET /nodes/{id}` | node card: location, data window, quality flags, no-data reason |
| `GET /nodes/{id}/kpis?type=solar\|battery&scenario=` | captured price, capture factor, % hours PML ≤ 0, IRR/NPV/LCOE, basis, assumptions used |
| `GET /nodes/{id}/series?metric=&grain=month\|day\|hour&from=&to=` | aggregated series (hourly capped; no raw bulk dump) |
| `GET /scores?type=solar\|battery&region=&top=` | ranked scores (same as map layer) |
| `GET /compare?ids=a,b,c` | side-by-side KPIs for up to 3 nodes |
| `GET /scenarios` | scenario definitions and editable battery-economics defaults |
| `GET /methodology/{metric}` | plain definition, formula, units, caveats (clock convention, RTE, ≥12-month rule) |
| `GET /meta` | data vintage, build tag, row counts, license/attribution |

Rules: responses small (paginate, default `limit=50`), every number carries `unit`, `as_of`, `source`,
and `assumptions` where applicable. Errors are structured (`code`, `message`, `hint`).

## Correctness report (required deliverable)
Agents will repeat our numbers, so the API must be provably consistent with the site.
- **Parity test**: for a fixed sample (>= 10 nodes across SIN/BCA/BCS + 2 no-data nodes), API values
  equal the JSON the UI renders, to display precision. Runs in `node --test` and CI.
- **Independent check**: `validador` recomputes KPIs for the sample from aggregates (not from our
  module) and writes `tests/validacion/api_parity.md` with tolerance, diffs, verdict.
- **Agent eval**: a fixed question set (>= 30: lookup, ranking, compare, "why is this node no-data",
  unit traps, clock/DST traps, battery RTE re-pricing) answered via a reference agent using only the
  API. Each answer is graded against ground truth; results go in `docs/M18_AGENT_EVAL.md`
  (pass rate, failures, root cause).
- **Correction loop**: every eval failure or user-reported wrong answer becomes a row in
  `docs/CORRECCIONES.md` (date, what, effect) and a fix in either the API field/description or the
  data; then the eval case is kept as a regression test. `GET /meta` exposes `corrections_version`
  so agents can detect stale knowledge.
- **Guardrails in descriptions**: tool/field descriptions state units, assumptions, and "do not
  extrapolate beyond data window"; no-data nodes return an explicit reason, never null-as-zero.

## Open decisions (Nico)
- Data licensing: confirm derived CENACE aggregates may be redistributed via API.
- Raw hourly PML exposure: default **no** (aggregates and capped series only).
- Key issuance: self-serve form vs. manual; free tier rate limits.
- Public vs. password-gated discovery of `/llms.txt` and the OpenAPI spec.

## Done when
Functions deployed, OpenAPI + llms.txt live, coverage test green, parity report and eval report
committed with pass rate >= 95% and all failures logged in CORRECCIONES, full suites green,
tag `v2-m18-agent-api` pushed.
