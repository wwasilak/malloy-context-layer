# Phase 2 — Eval loop: implementation spec

Context for a developer picking up EVAL-1..6. Assumes familiarity with the repo
(`build.js`, `okf-lib.js`, `kp/` bundle, `CLAUDE.md`). Read `ARCHITECTURE.md`
and `ROADMAP.md` first. Everything here builds ONE new artifact — an eval runner
— plus small support changes. No change to the plane or the models is required.

Deliverable: `npm run eval` produces a scored, timestamped, provenance-stamped
results file, runnable both in CI (against fixtures) and on a schedule (against
live data). It is the load-bearing item; BOOT-2 and OPT-5 depend on it.

---

## 0. Why this exists (don't skip)

The build proves the plane is internally consistent and links resolve. It does
NOT prove the agent, given the plane + CLAUDE.md, actually routes questions
correctly, applies membership rules verbatim, refuses ungoverned terms, or
computes the right number. Every review source we studied (MotherDuck, Anthropic,
the context-layer writers) converged on the same point: a semantic/context layer
is only as good as the eval loop that continuously tests it. Without this, every
"the agent will…" claim in our docs is untested.

The failure modes we have already SEEN in real sessions (freeze these as cases):
1. Re-deriving a governed concept from components (`sum(line_revenue-line_cost)`
   instead of `kp:Margin`) and defending it as allowed. See
   `kp/agent/evals/no-rederivation-margin.md`.
2. Naive projection that is silently wrong when relative time isn't anchored to
   the data's max date (the 2024 forecast session).
Both are regression cases the runner must catch.

---

## EVAL-1 — the runner

### Eval case format (already in use, extend it)

Cases live in `kp/agent/evals/*.md`: YAML frontmatter + a prose body explaining
intent. Current fields (see `aov-synonym.md`, `no-rederivation-margin.md`):

```yaml
type: eval                      # required — marks it an operational doc, skipped by okf-lib registry
title: ...                      # required
category: synonym | membership | refusal | tier-boundary | routing | coverage | computation
question: "..."                 # required — the user turn fed to the agent
expect_kind: numeric | refusal | contains | query_shape   # required — how to grade
expect_value: null              # numeric: the gold number (fill from gold_query)
tolerance: 0.01                 # numeric: relative tolerance, default 0.005
expect_contains: ["..."]        # contains: substrings the answer must include
must_use: kp:Margin             # optional — concept URI(s) the trace must reference
must_not_contain: ["..."]       # optional — patterns that must NOT appear (e.g. re-derivation)
gold_query: |                   # the verified Malloy that yields the gold value; also the query-shape reference
  run: ...
```

Two grading philosophies, support both (Anthropic's lesson: anchor ground truth
so it can't drift):
- **number grading** (`expect_kind: numeric`): run the agent, extract its final
  number, compare to `expect_value` within tolerance.
- **query grading** (`expect_kind: query_shape`): compare the agent's executed
  Malloy against `gold_query` semantically (see §EVAL-2) — grades the METHOD,
  survives data changes. Prefer this for anything time-relative.

### Runner architecture (`evals/run.js`, ~150 lines)

```
for each kp/agent/evals/*.md:
  1. parse frontmatter (gray-matter — already a dep)
  2. invoke the agent headless with `question` as the only user turn:
       claude -p "<question>" --output-format json   (Claude Code headless)
     capture: final text answer AND the full trace (tool calls = the Malloy that ran)
  3. grade per expect_kind:
       numeric      -> extract final number, compare within tolerance
       refusal      -> assert answer declines / labels ungoverned, no official figure
       contains     -> all expect_contains present
       query_shape  -> compare executed Malloy to gold_query (EVAL-2)
     plus cross-checks (independent of expect_kind):
       must_use         -> each URI appears in the trace
       must_not_contain -> none of the patterns appear in trace or answer
  4. record result row (EVAL-3 schema)
write results file; print summary; exit non-zero if any case fails (for CI)
```

Key implementation notes:
- The agent under test must run with the REAL `CLAUDE.md` + `kp/` context — the
  runner tests the shipped protocol, not a stub. In Claude Code headless the repo
  is the working dir, so this is automatic.
- Runs are stochastic. For each case run N=3 times; a case PASSES only if it
  passes consistently (all 3, or a configured quorum). Record per-run outcomes.
- Keep the runner model-agnostic: model id is an input, recorded in results.
- Numeric extraction is the fragile part. Prefer query grading where possible;
  for numeric, require the agent to emit the headline number in a parseable form
  (a fenced ```result block, or parse the last currency/number token) and log the
  raw answer so failures are debuggable.

### Gold values

For each numeric/query case, compute the gold once by running `gold_query`
against the fixture data (EVAL-4) via the same malloy runtime `build.js` uses,
and paste it into `expect_value`. Store the query alongside so gold is auditable
and regenerable. Do NOT hand-type numbers.

### CLI

```
npm run eval                    # all cases, fixtures, default model
npm run eval -- --case aov-synonym
npm run eval -- --live          # against live warehouse (drift runs)
npm run eval -- --model <id> --runs 3
```

---

## EVAL-2 — anchored ground truth (query grading)

Problem: numeric gold values rot when data changes. Two defenses, implement both:
1. **Fixtures freeze the numbers** (EVAL-4) — gold is valid as long as fixtures
   are unchanged.
2. **Query grading grades the method, not the number.** Compare the agent's
   executed Malloy to `gold_query`:
   - Normalize both (strip whitespace/comments, lowercase keywords) and compare;
     OR, more robustly, run BOTH against fixtures and assert identical result sets.
   - Running both is the strongest form: it proves the agent's query is
     equivalent to the blessed one without brittle string matching.
   - This is what makes time-relative cases ("last 2 years", projections) stable.

For cases where a single number is the point, keep numeric grading but pin it to
fixtures. For everything else, prefer running agent-query vs gold-query on
fixtures and diffing result sets.

---

## EVAL-3 — results as telemetry

Append one row per (case × run) to `evals/results/<UTC-timestamp>.jsonl` (JSONL,
git-committed or artifact-stored). Schema:

```json
{
  "ts": "2026-07-18T09:00:00Z",
  "case": "no-rederivation-margin",
  "category": "tier-boundary",
  "run": 1,
  "pass": false,
  "expect_kind": "query_shape",
  "grade_detail": "must_not_contain matched: sum(line_revenue",
  "agent_answer_excerpt": "...",
  "executed_malloy": "run: order_line_in_context -> ...",
  "tokens": 4210,
  "latency_ms": 32000,
  "semantic_identity": "sha256:...",     // EVAL-6
  "model_id": "claude-...",
  "runtime": "claude-code-headless x.y.z",
  "data_source": "fixtures@<hash> | live@<max_date>"
}
```

Why JSONL: regressions become a query ("show cases that flipped pass→fail
between the last two runs, grouped by category"). Write a 20-line
`evals/report.js` that diffs the two most recent result files and prints
flips + per-category pass rate. That diff is the actual product of the loop.

Also: on a passing run, stamp `last_validated: <date>` into the frontmatter of
each concept named in a passing case's `must_use`. That's the field
`ARCHITECTURE.md` already documents as "eval-runner-stamped" — nothing writes it
yet. (Write it the way `okf-lib.writeBack` edits files, or via gray-matter.)

---

## EVAL-4 — fixtures for CI

CI has no warehouse credentials and shouldn't hit live data. Commit small sample
parquet files (a few thousand rows, preserving the schema and enough variety to
make gold numbers meaningful) under `fixtures/ParquetFiles/`. The runner points
DuckDB at fixtures by setting WORKDIR / table paths to the fixture dir (same
mechanism `build.js` uses — DuckDB resolves `ParquetFiles/...` relative to
WORKDIR). Two run modes:
- **CI / PR:** fixtures — hermetic, fast, deterministic, gold values stable.
- **Scheduled drift:** live warehouse — same cases, `--live`, numbers may move;
  a move with unchanged `semantic_identity` means the data changed (expected);
  a move with changed identity means meaning changed (investigate).

Keep fixtures tiny and representative; document how they were sampled so they can
be regenerated. Gold values in cases are computed against fixtures.

---

## EVAL-5 — seed from real usage

Do not invent the eval set from imagination; harvest it. Sources, in priority:
1. The two known regressions (margin re-derivation, time-anchored projection) —
   already captured; verify they run.
2. `kp/agent/question-log.md` entries — each novel analysis is a candidate case.
3. `kp/agent/corrections.md` entries — each confirmed wrong answer becomes a
   regression case with the corrected result as gold.
Target ~30 cases across all categories before calling coverage adequate, with
refusal + tier-boundary over-represented (they catch the worst failures).
Establish the loop: every correction filed → a new eval case in the same PR.

---

## EVAL-6 — semantic identity hash

A hash that identifies the MEANING a number was produced under. Compute once per
run, store on every result row and (later) every answer receipt:

```
semantic_identity = sha256(
  git_tree_sha(kp/) +           // canonical plane content
  git_tree_sha(models/) +       // implementations
  malloy_version +
  duckdb_version +
  dialect + runtime_settings
)
```

Diagnostic value (the whole point):
- same identity, different number  -> the DATA moved (expected on live runs)
- different identity, any change    -> the MEANING moved (a KP/model edit) —
                                       drift is explained, not mysterious

Cheap to compute (git rev-parse HEAD:kp, package-lock versions). Fold into the
EVAL-3 row and into the provenance footer (AGT-1) so a stakeholder can later ask
"what definitions produced this?" and get an identifier, not prose.

---

## Order of work

1. EVAL-4 fixtures first (nothing grades without stable data).
2. EVAL-1 runner with numeric + refusal grading; wire the 4 existing cases.
3. EVAL-6 identity (trivial once runner exists) + EVAL-3 telemetry rows.
4. EVAL-2 query grading (run-both-on-fixtures); convert time-relative cases.
5. EVAL-5 harvest to ~30 cases; wire `last_validated` stamping.
6. Hook into CI (OPS-1): `npm run eval` on PR against fixtures, non-blocking at
   first (report only), promote to blocking once green and stable.

## Acceptance

- `npm run eval` runs all `kp/agent/evals/*.md`, N=3 each, against fixtures.
- Produces `evals/results/<ts>.jsonl` with the EVAL-3 schema incl.
  semantic_identity.
- `evals/report.js` prints pass-rate by category and pass→fail flips vs previous.
- The two known regressions FAIL on a deliberately reverted CLAUDE.md and PASS on
  the current one (proves the harness detects what it's for).
- Passing cases stamp `last_validated` on their `must_use` concepts.
- CI runs it on every PR (report-only to start).

## Non-goals for Phase 2

No autonomous definition edits from eval failures (proposals only — LLM
boundary). No live-warehouse dependency in CI. No adversarial-reviewer step
(that's OPT-1, triggered later). No UI — JSONL + a diff script is the product.
