# Roadmap — Knowledge Plane + Malloy models

**How to read this.** Work is tracked by stable codes (`EVAL-8`, `SIMP-1`, …)
that code comments and commit messages cite, so codes never get reused or
renamed. Short items live in tables; anything with reasoning worth keeping gets
its own section, with the status in the heading. Finished items keep their full
detail on purpose — the reasoning behind them is cited constantly by later work.

**Jump to:** [Status](#status--where-we-are) ·
[Phase 1](#phase-1--foundations--done) ·
[Phase 2](#phase-2--the-eval-runner--done) ·
[Phase 2b](#phase-2b--fixes-from-the-first-sweep-review) ·
[Phase 2c](#phase-2c--simplification) ·
[Phase 2d](#phase-2d--okf-spec-upgrade) ·
[Phase 3](#phase-3--server-adoption) ·
[Phase 3b](#phase-3b--bootstrap-a-new-domain) ·
[Phase 4](#phase-4--optional--triggered) ·
[Decided](#decided--do-not-relitigate) ·
[Lessons](#lessons-that-keep-coming-back)

---

## Status — where we are

**Branch `eval-12-tiering`, 2026-07-31.** Tree clean, all gates green at every
commit. `main` itself carries the whole eval loop: Phase 2 and Phase 2b were
merged as `838de26`.

| Commit | What |
|---|---|
| `352224d` | SIMP-3 (shared `malloy-lib.js`) + the first tracked unit tests |
| `c185349` | SIMP-4 (tier-0 checks into `build.js`) |
| `782b51d` | EVAL-12a / SIMP-1 (the tier-1 lane) |
| `ead4173` | EVAL-12d (the correlation check) + EVAL-14 (transport failures are not verdicts) |
| `f915fec` | EVAL-12c (the cache we already had, and the premise that said we didn't) |
| `48e581f` | EVAL-12b (impact selection + concurrency), which closes EVAL-12 |

**EVAL-12 is closed.** All four levers plus the invariant have shipped.

### Picked up next, in order

1. **Run `npm run eval:selftest`** — SIMP-5 rebuilt it on `--protocol` and
   nothing has driven the new path with a real agent. ~4 tier-2 runs, $2-4. It
   answers a question no unit test can: do the two regressions still
   DISCRIMINATE?
2. **EVAL-5 harvesting** — now the binding constraint on the correlation check
   itself: two tier-1 cases is a thin basis for a claim about a whole lane, and
   the check gets more convincing with every case that declares tier 1 — as long
   as each new one re-runs it. It is also what makes impact selection worth
   anything: selecting 2 of 6 cases saved $0.15 on 2026-07-31, selecting 20 of
   30 is the point.
3. **The ROADMAP is current** — no pending write-up.

**Then:** pick a server — INT-1/INT-2 first (both runtime-independent), then
INT-3a or INT-3b with INT-6.

**Continuously:** EVAL-5 harvesting toward ~30 cases; every correction filed gets
an eval case in the same PR.

**Newly queued:** Phase 2d, the OKF spec upgrade. Not scheduled against the EVAL
work yet; OKF-1 (pin the version) is worth doing on its own whenever, since it is
half a day and it is what makes the next spec bump detectable at all.

**On trigger only:** Phase 2c (SIMP-2 opportunistic, SIMP-6 when authoring cases
becomes the bottleneck), Phase 3b and Phase 4.

### Gates, and how to run them

`npm test` (85 cases, ~2s — one of them spawns the real CLI) → `npm run build`
(validation + tier-0 eval checks + write-back; must leave the tree clean) → `npm run eval:check`
(standalone form of the same tier-0 checks).

- `npm run eval -- --case <name> --runs 1 --no-stamp` — a single live case.
- `npm run eval -- --select` — only the cases the working tree could have moved
  (EVAL-12b). Refuses to run with `--live`.
- `npm run eval -- --concurrency 4` — fan out, after one serial run warms the
  prompt cache.
- `npm run eval -- --protocol <path>` — run against a different CLAUDE.md
  (SIMP-5). Swapped in and restored; results go to `evals/results/protocol/`.
- `npm run eval:correlate` — the cheap-lane validation. Costs 2x the runs of the
  cases it covers, so it rides the schedule, not PRs.

There was NO tracked unit test before `352224d`: `porcelainPaths` was exported to
be testable and its tests were never committed, which is the EVAL-8 lesson twice
over. `npm test` is now wired into the build gate ahead of `build.js`.

### What live runs cost

**Spent so far: ~$14.95.** ~$1.40 (29 Jul) + ~$4.30 (30 Jul — three correlation
runs, one of them the contaminated one) + $0.53 + $8.72 (31 Jul — EVAL-12b's
probe and its confirming sweep). A 2-case x 3-run correlation is ~$2.50 for both
lanes together.

**The cheapest useful live measurement in this repo is the tier-1 probe: 2 cases
x 3 runs at $0.53, ~64s.** It exercises the scheduling, gives a readable
`Prompt cache:` figure, seeds the ledger with fingerprinted rows, and it is what
found the EVAL-12b fan-out bug. Reach for it before a full sweep.

**A full 5-case x 3-run sweep is $8.72 / 10.2 min at `--concurrency 4`**
(2026-07-31), against $9.66 / 24.7 min serial for the comparable 2026-07-28
sweep. Concurrency buys 2.4x wall clock and is roughly cost-neutral.

**Per-run tier-1 cost depends on cache warmth, and quoting one number for it is
what produced EVAL-12c's wrong premise.** A COLD run (the first of a sweep) is
$0.12-$0.16; a WARM one is $0.025-$0.033. Sweeps are mostly warm runs, so project
a sweep at the warm price plus one cold start — not at $0.16 x N.

**Tier-2 runs are $0.41-$1.28** (measured 2026-07-31 across 13 runs; the earlier
$0.18-$0.43 came from a narrower sample and understated it —
`financial-situation-projection` alone is $0.91-$1.28 over 22-27 turns and is now
the most expensive case in the suite, ahead of `refusal-ungoverned`). Tier 2 does
not warm the way tier 1 does, since a growing session always has new context to
write: **every tier-2 run in that sweep wrote cache; only the tier-1 runs did
not.** Read the `Prompt cache:` headline with that in mind — on a tier-2-heavy
sweep it reports intra-session reads and says almost nothing about cross-run
warming.

### Where the phases stand

Phase 1 → DONE. Phase 2 (the eval loop) → DONE and running.

Within Phase 2b: EVAL-7 and EVAL-8 → DONE (the signal-distorting pair;
measurements from here on are trustworthy). EVAL-9 and EVAL-10 → DONE
(soundness: no more passing on a number found anywhere, no more cases that
cannot fail). AGT-3 → DONE. EVAL-11 → DONE, by case conversion. EVAL-13 → 2 of
3, the third folded into SIMP-2. **Phase 2b is CLOSED** — EVAL-12b was the last
item in it.

**Both new cases are validated** — evidence:
`evals/results/2026-07-29T11-08-29Z.jsonl`. They ran end-to-end through an agent,
3/3 unanimous each, $1.85 for the six runs. `aov-synonym` scored exact, exact,
subset over 9-12 turns and 3-4 Malloy calls — the trajectory varies run to run,
which is precisely the variance the regex ladder used to arbitrate, and method
grading absorbs it. `refusal-routing-decision` made 0 Malloy calls on all three
runs at 6-8 turns and ~$0.22, inside its `max_malloy_calls: 0` budget. Nothing in
the suite now asserts behaviour nobody has observed.

**The correlation check is ESTABLISHED as of 2026-07-30**, so the first condition
on SIMP-1 is met — see EVAL-12d for exactly how narrow that licence is, and
EVAL-14 for the harness bug the check found on its first real run.

---

## Phase 1 — Foundations · DONE

| Code | Item | Detail |
|---|---|---|
| GOV-1 | Profile for CLAUDE.md | Frontmatter added to CLAUDE.md: owner, status, approved_by, timestamp (owner/approved_by = Knowledge Plane). The most powerful context file must not be the least governed. |
| GOV-2 | Global/local tiers | `global/` folder (renamed from core) = company-wide definitions; domain folders = local. Promotion path: shared-concepts report flags candidates → reviewed PR moves the file. Same label, different meanings = distinct URIs; ambiguous labels resolve to global. One definition per URI stands. |
| AGT-1 | Provenance footer | CLAUDE.md "Answer receipt" section: every answer ends with basis (governed measure / exploratory), data freshness (max date used), concept steward. The main mitigation for silent wrong answers. |
| AGT-2 | "Don't bail early" rebuttals | CLAUDE.md pre-rebuttal block in the Analysis-freedom section: the excuses for abandoning governed measures ("needs a custom date window", "needs a join", "needs a ratio" — none justify raw-column improvisation). |
| OPS-1 | CI workflow | `.github/workflows/build.yml`: runs `npm run build` on every PR and push to main; fails on validation errors; fails if the working tree is dirty after build (forcing committed write-back). Turns every guarantee in this repo from convention into gate. |
| OPS-2 | Steward onboarding + README refresh | `docs/steward-onboarding.md`: how to add/edit a concept (template, frontmatter, PR, what each build error means). README rewritten for the OKF-bundle reality (MOTLY/knowledge_map.json era removed). |

---

## Phase 2 — The eval runner · DONE

Shipped as `evals/` + `.github/workflows/eval.yml`. See `docs/evals.md` and
`PHASE2_SPEC.md`. `npm run eval` produces a scored, timestamped,
provenance-stamped results file; `npm run eval:report` diffs the last two runs.

| Code | Item | Status | Detail |
|---|---|---|---|
| EVAL-1 | Eval runner | done | `evals/run.js` loops `kp/agent/evals/*.md` through headless Claude Code (prompt over stdin), grades numeric/refusal/contains/query_shape/analysis, runs each case N=3 with a quorum, exits non-zero on failure. Cross-checks (`must_use`, `must_not_contain`, `expect_receipt`) run for every kind and are what catch the real failures. |
| EVAL-2 | Anchored ground truth | done | `query_shape` grading runs the agent's Malloy AND the `gold_query` against the same data and compares result sets (order-insensitive; `exact` / `values` / `subset` recorded). Gold numbers are pinned to committed fixtures. `membership-verbatim` converted to method grading — its bound measure anchors to `LOCALTIMESTAMP`, so a pinned number would rot on a calendar boundary. |
| EVAL-3 | Results as telemetry | done | One JSONL row per (case × run) in `evals/results/`, plus a `run_meta` header line. Records verdict + reason, answer excerpt, executed Malloy, extracted vs expected, tokens, cost, latency, turns, receipt presence, semantic identity, model, runtime, data source. `evals/report.js` prints per-category pass rate, pass→fail flips and flaky cases. `last_validated` stamping on passing `must_use` concepts — the writer `ARCHITECTURE.md` documented but nothing implemented. |
| EVAL-4 | Fixture data for CI | done (no new files) | The parquets under `ParquetFiles/` are already committed, so CI checks out byte-identical data and gold values are already stable. A second sampled copy would add a sync burden and a fixture-vs-live gold discrepancy for no gain, so `fixtures` means the committed set resolved via WORKDIR (as `build.js` does), and `--live` switches to `EVAL_LIVE_WORKDIR`. |
| EVAL-6 | Semantic identity hash | done | `sha256(digest(kp/) + digest(models/) + digest(CLAUDE.md) + malloy/duckdb/dialect)` on every result row; `eval:report` uses it to say whether a flip means the data moved or the meaning moved. Digests the WORKING TREE (evals matter most on uncommitted edits); git tree shas recorded alongside with a dirty flag. `CLAUDE.md` is included because the routing protocol can move every number without touching a concept. |
| EVAL-5 | Seed from real usage | **ongoing** | Both known regressions run and are covered by the selftest. Harvesting from question-log/corrections continues; target ~30 cases, refusal + tier-boundary over-represented. |

### Also shipped, not in the original spec

| Item | Detail |
|---|---|
| `eval:gold` / `eval:check` | Gold values are computed from `gold_query` and written into the case, never typed. `eval:check` is the read-only CI form — verifies every case parses, every gold query still runs, and no committed value drifted, with no agent involved, so it can gate today. It immediately found two cases whose gold queries had never been executable. |
| `eval:selftest` | The regressions must FAIL against a deliberately stripped `CLAUDE.md` and PASS against the real one. A suite that passes everything is indistinguishable from one that grades nothing. |
| committed-vs-explored grading | `must_not_contain` matches only what the agent COMMITTED to (final answer + executed queries); `must_use` matches everything it touched. Reading a binding's definition is not re-deriving it — `average_order_value` is literally defined as `total_sales / order_count`, so compile output echoes the forbidden pattern back at a correct agent. Originally shipped as authored-vs-read, which still included compiles; narrowed to committed-vs-explored by EVAL-7. |

---

## Phase 2b — Fixes from the first sweep review

Findings from reviewing the shipped harness against its own first full sweep —
evidence: `evals/results/2026-07-28T17-35-59Z.jsonl` (5 cases x 3 runs, 4/5
passed, $9.66, 6.5M tokens, 24.7 min). Ordered by priority: the first two distort
the signal the loop exists to produce, so they came before anything else,
including performance.

**Everything here is DONE** (EVAL-13's third item deliberately, into SIMP-2).

### EVAL-7 · `must_not_contain` scope — false positive · DONE

The only failing run in the sweep was almost certainly a grader error.

**Diagnosis.** `no-rederivation-margin` run 3: its final answer and BOTH executed
queries use the governed binding (`product_performance -> { aggregate: margin }`);
the forbidden pattern appears nowhere in either. It matched in `authoredText`,
which also carries **compile-stage** tool inputs and intermediate prose — runs 1-2
made 3 Malloy calls, run 3 made 4, so one extra *compile* (explaining or testing
an expression it then correctly discarded) failed the case. Exploration is not
commitment.

**Fix.** Match `must_not_contain` against executed queries (`RUN_TOOLS`) plus the
final answer only; keep `must_use` searching the full trace. **Also:** record the
matched snippet with ~200 chars of context in the result row — before this, the
telemetry could not adjudicate its own verdict.

### EVAL-8 · `last_validated` stamping poisons the identity signal · DONE

The eval runner was quietly invalidating the signal EVAL-6 exists to produce.

**The problem.** `run.js` writes the date into `kp/**` after a passing run;
`identity.js` digests the `kp/` working tree. Every successful sweep therefore
changed `semantic_identity`, and the next `eval:report` announced "the MEANING
moved" when only a date moved — the exact false signal EVAL-6 exists to prevent.

**Fix.** Strip `last_validated:` lines in `treeDigest`, and exclude
`kp/agent/gap-log.md` and `question-log.md` (appending a gap does not change
meaning). Keep `examples.md` and `corrections.md` standing hints IN — those do.
**Also fixed:** the `dirty` flag ignored the same files and any concept file whose
only diff from HEAD is its stamp — a flag reporting drift the hash ignores is a
second false signal.

**Validated in the wild (2026-07-29).** A passing run stamped
`kp/sales/average-order-value.md`, and the identity recomputed after that write is
byte-identical to the one in the results header (`sha256:c5ad2793…`). A stamp no
longer moves the meaning.

**The same check found a bug introduced by this item.** `gitDirty` trimmed the
whole `git status --porcelain` output before splitting, which strips the leading
status-column space of the FIRST line only (` M path` → `M path`), so `slice(3)`
ate a character of that one path; the lookup missed, `stampOnlyChange` diffed a
file that does not exist, and the flag reported dirty for a stamp-only tree — the
exact false signal EVAL-8 exists to remove. Every later line keeps its space, so
it corrupted precisely one entry and read as correct. Parsing extracted into
`porcelainPaths()` (handles MM / `??` / renames / quoted paths), with a test per
case; confirmed stamp-only → `dirty: false`, real content edit → `dirty: true`.

**Note for EVAL-12:** every unit test written for EVAL-8 passed against the broken
code, because they exercised `treeDigest` and not the flag.

### EVAL-9 · `subset` verdict is unsound · DONE (both dimensions)

**The problem.** `containsAll` compared *flattened* value multisets, so gold values
found anywhere in the agent's output passed: a gold scalar of `47` passed against
any 200-row result that happened to contain a 47.

**Fix, and both options shipped.** Containment is now column-and-row aware — extra
*columns* pass, extra *rows* do not (a different row count is a different grain).
Leftover column names are searched, not guessed, so the agent may still alias
output (`category_margin is margin`) without failing; a same-named column that
disagrees is never re-mapped to one that agrees; the search is bounded (≤3
unmapped, ≤8 spare). Plus `min_match: subset|values|exact` per case (default
`subset`) for cases that want the shape pinned harder. Verified on the real
`membership-verbatim` gold: scalar 31576 padded with 50 rows was `subset`, now
`none`.

**REOPENED and closed again (2026-07-29) — the same hole survived in the COLUMN
dimension.** Writing the first unit tests for `containsAll` found it: the rename
search anchors gold columns to agent columns by name and searches for the rest,
which is right for aliases, but it had no evidence requirement. With a single-row,
single-column gold there is one number and no structure, so it bound that number
to whichever column happened to hold it — an agent returning `order_count: 47`
satisfied a gold `active_customers: 47`. Live on BOTH scalar-gold cases, which
default to `min_match: subset`.

**Second fix.** A rename now needs an anchor: one column agreeing by name, or more
than one row so a coincidence has to repeat. Nothing legitimate pays for it — a
pure rename with no extra columns is already caught one tier up by `values`, and
`subset` only decides cases where the agent returned EXTRA columns. Checked
against the run that actually scored `subset` (aov-synonym run 3:
`average_order_value` alongside `total_sales` and `order_count`) — anchored by
name, still passes.

**Lesson worth keeping: "closed in the row dimension" was mistaken for "closed".**

### EVAL-10 · `analysis` cases can be vacuous · DONE

**The problem.** `grade.js` returns `pass: true` for the kind and lets cross-checks
decide, but `cases.js` never required any. An `analysis` case with empty
`must_use`, empty `must_not_contain` and no `expect_receipt` passed
unconditionally, forever, while looking like coverage.

**Fix.** Load-time error when an `analysis` case carries no cross-check. Both
committed `analysis` cases already carry them, so the suite is unaffected — the
guard is for the next one.

### AGT-3 · Cheap refusal — a protocol fix found by telemetry · DONE

**The observation.** `refusal-ungoverned` burned 18-24 turns and $0.76-0.91 per run
to conclude a term is not governed — more than the case that actually computes a
number, and the second most expensive case in the sweep. Every real user asking
about an ungoverned term pays the same. Eval cost is a sensor for protocol waste.

**Diagnosis corrected on inspection.** The trace shows only 3 executed queries out
of 7 Malloy calls, and they compute a well-formed *exploratory CLV* — which
CLAUDE.md explicitly sanctions for an ungoverned term (tier 3). Most of that spend
is the sanctioned computation, not confirmation of a gap, so the originally
proposed `malloy_tool_calls <= 1` assertion would have failed correct behaviour.

**Shipped.** The CLAUDE.md line as specified (absence from the routing table is
conclusive; inspect a source only to compute an exploratory figure already decided
on), plus a `max_malloy_calls` cross-check and a new companion case
`refusal-routing-decision` that asks ONLY the routing question — no number in the
right answer — with a budget of `0`. Cheapness is asserted where cheapness is
genuinely required.

**Validated end-to-end (2026-07-29).** 0 Malloy calls on all three runs, 6-8 turns,
$0.21-0.23 — roughly a quarter of `refusal-ungoverned`'s 18-24 turns and
$0.76-0.91. Part of that gap is the sanctioned exploratory computation the other
case does, but the routing decision itself is now demonstrably reachable without
touching the models.

### EVAL-11 · Numeric extraction fragility · DONE

**The problem, confirmed.** `aov-synonym` extracted via `currency` twice and `bold`
once across three identical questions — it survived on the luck of answer
ordering, and the first answer that leads with a different figure breaks it.

**Fix, in order of preference.** Prefer `query_shape` for anything that can be
method-graded. Where a number genuinely is the point, extract the figure nearest a
case-specified label rather than the first match, and keep recording `how`. Do not
bend CLAUDE.md into emitting a machine-readable fence just to suit the grader —
that is the test changing the product.

**Shipped the preferred fix only, and that is the whole fix.** `aov-synonym`
converted to `query_shape` against its existing gold. The second option was
deliberately NOT built: it hardens `extractNumber`, which the conversion leaves
with zero callers (it was the only `numeric` case) and which SIMP-1 deletes.

**Tradeoff accepted.** The case now also asserts shape — computing AOV for every
year and reading the 2023 row off scores `none` — and no longer checks the figure
quoted in the prose.

**Validated end-to-end (2026-07-29).** exact, exact, subset across three runs at
9-12 turns and $0.37-0.44 — two runs matched the gold exactly, the third carried
extra context columns, and the case passed on method rather than on which figure
the prose happened to lead with.

### EVAL-12 · Make the suite cheap enough to run on every PR

**The starting point.** Serial, no caching, no tiering: 5 cases x 3 = 24.7 min /
$9.66, which is ~2.5 h / ~$58 at the EVAL-5 target of 30 cases.

**Four independent levers, in leverage order.**

- **(a) Tiering.** Most cases test a *decision*, not a trajectory. Tier 0 (no LLM:
  gold compiles, every approved concept has a binding — belongs in `build.js`);
  tier 1 (one call, no tools: routing table + question → "which concepts, what
  Malloy?", graded on `must_use`/`must_not_contain`/query shape, ~seconds); tier 2
  (full agentic, only where multi-turn behaviour IS the test — self-verification,
  the projection case, logging discipline; ~5 of 30). The 21-turn refusal is the
  proof: 627k tokens to observe a turn-one decision.
- **(b) Impact selection.** EVAL-6 identity is already a cache key: unchanged
  identity + unchanged case = unchanged result, so a PR runs only cases whose
  `must_use` intersects the changed concepts, plus last run's failures; full sweep
  nightly.
- **(c) Prompt caching + Batch API** on the shared CLAUDE.md + routing-table prefix.
- **(d) `--concurrency`** — the boring 4x; runs are independent and the grader
  shares no state.

**The invariant.** Every cheap tier must be periodically validated against the
expensive tier it replaces (a correlation check in the nightly sweep), or you get
a green suite over a wrong product. This is not hypothetical: the EVAL-8
dirty-flag bug survived a full set of passing unit tests and was caught only by
running the harness for real and checking a number against expectation. The
correlation check ships **with** SIMP-1, not after it.

**Where the levers stand — all four are DONE.** (a) see EVAL-12a. (c) see
EVAL-12c, where the measurement that closed it showed the lever was already
ours. (b) and (d) shipped together as EVAL-12b. The invariant is DONE too — see
EVAL-12d, and it earned its keep on its first real run by finding EVAL-14.

**What that does NOT mean.** Three of the four levers have been measured in the
wild; EVAL-12b has not. Its projected saving is a projection, and EVAL-12c is
the standing warning about believing one of those before the sweep has answered
it.

### EVAL-12a · Tier 1, the cheap lane · DONE

One call, no tools, structured JSON out (`evals/lib/tier1.js`): the agent names
the concepts it routed to and the query it WOULD run, and the harness executes
that query against the same fixtures. `tier: 1|2` per case, **default 2** so
nothing becomes cheap without someone choosing it; `--tier` forces a lane.

CLAUDE.md is neither touched nor injected — it is auto-discovered as in a real
session, so tier 1 differs from tier 2 in TOOLS and TURNS and nothing else, which
is the only thing that makes comparing them meaningful.

**Two things only running it could show.**

1. *Notation.* The first tier-1 run routed perfectly and then wrote
   `run: sales.sales_performance`, copying the routing table's
   `model.source.field` binding verbatim — a tier-2 agent learns the right form
   from the compiler, and tier 1 had the compiler removed. The prompt now states
   the convention. Compensate in the harness for context the harness removed,
   never in CLAUDE.md.
2. *Compile-repair.* Tier 1 gets ONE repair round, where the harness hands the
   compiler's own error back — bounded, machine-generated, toolless, not the
   trajectory layer returning. It repairs only a query that FAILS TO RUN; a
   wrong-but-runnable query is a wrong decision and is graded as one, never
   coached into agreement.

### EVAL-12d · The correlation check · DONE

EVAL-12's invariant made executable: `npm run eval:correlate` runs every case
declared `tier: 1` in BOTH lanes and compares the verdicts. It does not
reimplement the runner — it invokes `run.js --tier 1` and `--tier 2` over the same
cases, so grading, cross-checks and gold execution are literally the sweep's code;
the arithmetic is a pure module (`evals/lib/correlate.js`) with 20 unit tests.

**The asymmetry is the design.** FALSE GREEN (tier 1 passes what tier 2 fails) is
the dangerous direction — nobody looks at a green suite. FALSE RED is loud and
self-correcting but still a broken proxy. Both fail the gate.

**Both lanes failing is not agreement.** `kind_pass` and the cross-check names now
travel on every row, so a shared verdict reached for different reasons is reported
as inconclusive rather than as evidence.

**Provenance outranks the arithmetic.** Two lanes at different semantic
identities, data sources or models give `INVALID`, not a verdict — perfect
agreement between two different products has compared nothing. Exit 0 means one
thing only: the proxy is validated.

**Other properties.** Running a tier-2 case cheap is a PROBE (eligible / not
eligible) and never fails the gate. Never stamps `last_validated`. Writes to
`evals/results/correlation/<ts>/` so a forced-tier sweep is never diffed against a
normal one by `eval:report`. Rides the scheduled + dispatch CI runs, not PRs.

**VERDICT ESTABLISHED (2026-07-30)** — evidence:
`evals/results/correlation/2026-07-30T09-44-43Z/`. Both tier-1 cases 3/3 in both
lanes, $0.55 tier 1 vs $1.97 tier 2 (3.6x). One benign difference the check
surfaces and the verdict alone would hide: `aov-synonym` matches `exact` in tier 1
and `exact`/`subset` in tier 2 — the agentic lane returns extra context columns.

### EVAL-14 · Transport failures are not verdicts · DONE

*Found by EVAL-12d's first real run.*

**The problem.** The CLI returns an API failure in the SAME envelope shape as a
successful reply — the error text lands where the answer would be — so
`API Error: 529 Overloaded` reached the grader as an answer that routed to no
concepts and ran no Malloy, and scored as a confident product failure.

**It invalidated the correlation check's first real run.** 3 of 6 tier-1 calls got
a 529, `refusal-routing-decision` was reported FALSE_RED, and the only difference
between the lanes was which calls the API dropped. Contaminated evidence kept at
`evals/results/correlation/2026-07-30T09-11-43Z/`. A cost sensor that reads
infrastructure as behaviour is the same class of bug as EVAL-7 and EVAL-8, in a
new place.

**Fix.** `transportErrorOf` classifies a reply that BEGINS with an API/network
error — anchored, so an answer that merely mentions one is still an answer. Such a
run is retried up to 3 attempts (429 and 5xx only, since a 401 will not fix
itself), with `attempts` recorded so a flaky API stays visible. If the retries are
exhausted the row is `errored: true` and is **excluded from the quorum, not
counted as a failure**. A case with any errored run does not pass — fewer completed
runs than the quorum means there is no quorum. In the correlation check a lane
below quorum has NO verdict and classifies the pair INCOMPLETE, so one lane's bad
luck can never read as a disagreement with the other.

**The line that decides it:** a reply that fails to PARSE, or a run that hits the
turn cap, is behaviour and stays a genuine failure. The distinction is whether the
agent answered at all.

### EVAL-12c · Prompt caching across runs · DONE — and the premise was wrong

**The item used to read:** *"~80% of tier-1 spend is the same ~11k-token prefix
paid for again on every run; Batch API and/or a persistent session attacks the
actual cost driver."* That was projected from a SINGLE tier-1 run — which was run
1 of 3, the one run in a sweep guaranteed to be cold.

**Reading all six runs of the established correlation sweep refutes it**
(`evals/results/correlation/2026-07-30T09-44-43Z/`). Caching already works across
separate `claude -p` processes: it is content-keyed on the prefix, not on the
session, so the cache warms over the first run or two and then stays warm.

| Case | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| `aov-synonym` | 13,258 created / 2,711 read — $0.161 | 10,798 / 5,803 — $0.183 (one repair) | **0 created** / 15,969 read — **$0.033** |
| `refusal-routing-decision` | 10,191 / 5,803 — $0.122 | **0** / 15,994 — **$0.025** | **0** / 15,994 — **$0.030** |

A cold run is $0.12-0.16; a warm one is $0.025-0.033. **~5x, and it is already
ours.** The prefix is shared across *different cases*, not just across runs of one
— which is why case 2 started half-warm.

**Consequence: the projected cost of a full tier-1 sweep drops by roughly 5x**,
because a sweep pays the creation once and reads it 89 times, not 90 creations of
identical text. See "What live runs cost" in Status for the corrected figures.

**What actually shipped is therefore not a caching mechanism but the three things
that keep the one we have.**

1. *The invariant, now tested.* `buildPrompt` puts the question LAST, below the
   preamble and routing table, which is the only reason the prefix is shared at
   all. It was true by luck and nothing asserted it, so interpolating anything
   case-specific higher up would have taken the 5x back with no verdict changing
   and no test failing. Two tests pin it: an identical prefix across cases, and a
   repair prompt that EXTENDS the base rather than rebuilding it.
2. *A telemetry fix found in the same data.* On a repaired run, `cost`/`tokens`
   accumulated both API calls while `usage` kept only the last envelope, so the
   breakdown disagreed with the total it breaks down (`aov-synonym` run 2: tokens
   34,774, usage summing to 17,686). That breakdown is the sensor this whole item
   reads.
3. *`Prompt cache: N% of prefix tokens read, not written`* in the sweep summary,
   so a regression is visible rather than merely expensive.

**Not built, and why.**

- **Persistent session across runs of the same case — rejected on correctness, not
  cost.** Run 2 would see run 1's answer, so the N=3 runs stop being independent
  samples and the quorum stops meaning anything. It would trade the suite's only
  defence against a stochastic product for a saving the API already gives us free.
- **Batch API — rejected on fidelity.** It means bypassing `claude -p` and
  hand-injecting CLAUDE.md, which breaks EVAL-12a's invariant that tier 1 differs
  from tier 2 in TOOLS and TURNS *and nothing else* — the property that makes the
  correlation check a comparison rather than two unrelated measurements.

Both were queued against a cost driver that turned out not to exist.

### EVAL-12b · Impact selection + concurrency · DONE

**The last EVAL-12 lever, shipped as two opt-in flags** — `--select` and
`--concurrency <n>` (`evals/lib/select.js`, `evals/lib/pool.js`). A sweep with
neither flag behaves exactly as it did before, which is deliberate: the same
rule as `tier:` defaulting to 2 — nothing becomes cheap until someone chooses
it.

#### Impact selection is a per-case FINGERPRINT, not a git diff

The roadmap phrased (b) as "cases whose `must_use` intersects the changed
concepts, plus last run's failures", which needs a baseline ref to diff against.
It is built as a content hash instead, for three reasons: it needs no ref (so it
works on uncommitted edits, which is where EVAL-6 already says evals matter
most), it cannot be fooled by picking the wrong base, and it subsumes "plus last
run's failures" without a special case — a failure is simply never evidence.

Every result row now carries a `case_fingerprint` over the inputs that case's
verdict can depend on:

| component | why it is in |
|---|---|
| the case file | question, gold query, cross-checks |
| its `must_use` concepts, plus the `of:` / `subtype_of:` chain | the definitions it routes to. Editing `kp:Customer` can change what `kp:ActiveCustomer`'s membership rule MEANS without touching its file |
| the routing **surface**: every `uri\|kind\|status` | a concept appearing, disappearing or becoming approved changes what ANY question can route to — including a question whose right answer is "that is not governed" |
| `kp/agent/examples.md`, `corrections.md` | standing hints the agent acts on; EVAL-8 kept them inside the semantic identity for exactly this reason |
| `models/`, `CLAUDE.md`, the runtime | shared by every case, so an edit here selects everything — the safe direction |

**Why not just `semantic_identity`?** It is the same idea one size too large: it
covers the whole repo, so editing one concept changes it and every case is
re-measured for a definition only one of them routes to. `models_tree` and the
protocol digest are *passed in* from `semanticIdentity` rather than recomputed —
two functions that must agree about the same tree is the EVAL-8 shape, and there
is no reason to have two.

**Why the surface is `uri|kind|status` and not `kp/index.md`.** CLAUDE.md tells
the agent to read the routing table whole, so the naive move is to digest it. But
the index is a *projection* of the concept files: digesting it would make every
definition edit select every case, and the mechanism would do nothing at all.
What genuinely reaches every case is a concept appearing, disappearing or being
approved — which is precisely what the surface digest catches.

#### What licenses a skip

A clean, COMPLETE measurement at the same fingerprint, in the same lane, against
the same data and the same model: at least as many passing runs as this sweep
would do, and **not one** failing or errored run. The all-or-nothing rule is what
stops a flaky 4-of-5 being averaged into a pass, and it is where "plus last run's
failures" comes from for free.

**Three refusals, all because a false skip is invisible — nobody re-reads a case
that never ran.**

1. **A case with no `must_use` is NEVER skipped.** Its concept dependencies are
   undeclared, so nothing here can tell whether the definition someone just
   edited is one it routes to. `must_use` is a declaration of dependency, and
   only a case that makes one can be selected out. The price today:
   `refusal-ungoverned` declares none, so the most expensive case in the suite
   ($0.76-0.91) can never be selected out. That is left standing rather than
   papered over with a guess about what it depends on.
2. **`--select` is refused with `--live`.** Live data can move underneath an
   identical fingerprint, and measuring exactly that is the one thing a drift
   run exists for.
3. **A skipped case is recorded on a `kind: selection` meta line, never as a
   result row** — and `isResultRow` is now shared by the ledger, `eval:report`
   and the correlation check. Otherwise one sweep's pass would propagate forever
   through sweeps that never ran the case: evidence manufacturing itself.

`eval:report` reads the same line and reports a skipped case as NOT COMPARED
rather than as a case that vanished, and the sweep summary prints NOT RE-MEASURED
next to the pass rate — because "6/6 passed" over a selected sweep means "2
measured, 4 assumed", and that difference is the whole risk of the feature.

#### Concurrency: warm before fanning out, in BOTH dimensions

`runPool` runs job 0 alone to completion, then fans out to N workers.
`serialize` keeps DuckDB to one query at a time: grading queries are
milliseconds against the agent's minutes, so the wall-clock cost is nil and it
removes concurrency as a possible explanation for a verdict, which is the whole
reason a sweep is worth reading.

**That is one rule, and it shipped needing two.** See the measurement below —
the first live run found that job 0 warms only the block every case shares, and
a second rule was added: the other runs of a CASE wait for that case's first
run.

#### MEASURED 2026-07-31 — evidence: `evals/results/2026-07-31T13-06-15Z.jsonl`

The tier-1 probe: `--case aov-synonym,refusal-routing-decision --runs 3
--concurrency 4 --select --no-stamp`. 6/6 passed, $0.53, 64s wall clock against
129s of summed run latency — **2.0x**, and the serial warm-up run is 29s of
those 64s.

| case | run | created | read |
|---|---|---|---|
| `aov-synonym` | 1 | 15,852 | 0 |
| `aov-synonym` | 2 | **0** | 15,852 |
| `aov-synonym` | 3 | **0** | 15,852 |
| `refusal-routing-decision` | 1 | 10,191 | 5,686 |
| `refusal-routing-decision` | 2 | **10,191** | 5,686 |
| `refusal-routing-decision` | 3 | 0 | 15,877 |

**The bug this found, which no unit test could have.** The tier-1 prompt caches
in TWO blocks — a ~5.7k block every case shares, and a ~10k block per case
(CLAUDE.md, the routing table and the question cache together, so a different
question invalidates the whole block). Job 0 warms the shared one. It cannot
warm the second case's own block, and the fan-out started
`refusal-routing-decision`'s runs 1 and 2 within the same second, so **both
created the identical 10,191 tokens**. Total creation 36,234 against a
best-possible 26,043; 62% of prefix tokens read where perfect scheduling gives
71%.

**Warmed in the run dimension, cold in the case dimension.** That is the EVAL-9
lesson exactly — "closed in one dimension is not closed" — arriving in a third
place.

**Fixed:** a case's followers now wait for that case's leader; leaders of
DIFFERENT cases still overlap, because their per-case blocks genuinely differ
and serialising them would buy nothing. Four unit tests pin the rule, and the
one that first passed against the broken code was rewritten: dropping the park
still DRAINS the queue (the last worker standing picks the rest up), so "every
job ran" is not the property — the property is that the followers OVERLAP, and
a retiring worker silently makes a concurrent sweep serial.

On this schedule the fix is free in wall clock: `aov` 2/3 and `rrd` 1 fill the
same window, and `rrd` 2/3 follow at 11s each.

#### CONFIRMED 2026-07-31 — evidence: `evals/results/2026-07-31T13-39-16Z.jsonl`

Both lanes, 32 minutes after the probe (so past the cache TTL — run 1 creating
at all is what proves the blocks had expired). `--runs 3 --concurrency 4
--select --no-stamp`: 5 cases selected, 1 skipped, **5/5 passed, $8.72, 10.2 min
wall clock against 24.9 min of summed run latency — 2.4x**.

**The fix is confirmed by a direct A/B on the same case.**

| `refusal-routing-decision`, tier 1 | run 1 | run 2 | run 3 |
|---|---|---|---|
| before the fix (13:06 probe) | 10,191 created | **10,191 created** | 0 |
| after the fix (13:39 sweep) | 13,173 created | **0** | **0** |

Tier-1 read share 72%, and no duplicate creation anywhere. The gate is visible
in the timestamps too: all 10 followers across the 5 cases started at or after
their leader finished, zero violations, while leaders of different cases still
overlapped (`membership-verbatim` run 1 and `no-rederivation-margin` run 1 both
started at +216s).

**Tier 2 behaves as EVAL-12c predicted and the sweep summary must not be read
naively.** The headline said `Prompt cache: 92% read` — but 13 of 15 runs were
tier-2 sessions, whose reads are dominated by re-reading their own growing
context every turn, and every one of them wrote cache. **The cross-run warming
signal is only readable in the tier-1 rows.** A 92% headline over a tier-2-heavy
sweep says almost nothing about the scheduling this item exists to get right.

**Concurrency is a wall-clock win and roughly cost-neutral**, as expected: $8.72
here against $9.66 for the original serial sweep at a near-identical 24.7 min of
serial-equivalent work.

**And a number the design decision now has a price tag on.** `--select` skipped
`aov-synonym` and saved ~$0.15. Meanwhile the "no `must_use` → never skipped"
rule forbids skipping `refusal-ungoverned` at **$2.04 per sweep** — an order of
magnitude more than selection saved. The rule is still right (its dependencies
genuinely are undeclared, and guessing them is how a false skip happens), but
the cost of that correctness is now measured rather than asserted. If it ever
needs closing, the move is to let a case DECLARE the dependency it asserts the
absence of, not to relax the rule.

#### Still not proven

- **Skipping caches a STOCHASTIC verdict.** Three passing runs at a fingerprint
  is evidence, not proof; the product can still fail on the fourth. That is why
  selection is a PR-level economy and every other trigger re-measures.
- **The CI wiring has never run.** The artifact download and the
  PR-vs-push branch in `eval.yml` are untested YAML; both fail toward a full
  sweep, which is why they were shipped that way.
- **The writer half is pinned only by a live sweep.** Thirteen mutations of
  `select.js` / `pool.js` were confirmed to go red (drop the stamp stripping,
  the surface, the hints, the `of:` closure; ignore failing runs; skip on
  partial evidence; skip an undeclared case; let a selection line count as a
  result; fan out cold; drop the per-group gate; serialise every leader; retire
  instead of parking; drop the serialize queue). What no unit test covers is
  `run.js` actually writing `case_fingerprint` onto each row — the EVAL-8
  corollary again, a helper test is not a wiring test. The mitigation is
  structural rather than tested: `loadLedger` ignores any row without a
  fingerprint, so that wiring breaking means the feature quietly does nothing,
  never that it skips wrongly. Both live runs confirm it is written, and the
  second one consumed the first one's rows to make a real skip.

### EVAL-13 · Minor harness fixes · 2 of 3 DONE

- **`ALLOWED_TOOLS` omitted `mcp__claude_ai_Malloyyo__query`** although `RUN_TOOLS`
  recognises it, so Malloyyo runs would be blocked at the tool gate. **Done**,
  together with `describe_source` / `list_sources`: CLAUDE.md requires
  inspect-before-run, so allowing the query alone leaves the runtime broken a
  different way. A test now asserts every `RUN_TOOL` is allowed at the gate.
- **`--live` still stamped `last_validated` from non-fixture data.** **Done** —
  suppressed unconditionally under `--live`, including against an explicit
  `--stamp`, and announced in the summary.
- **`report.js` splits one diagnosis sentence across two `if` chains.**
  **Deliberately NOT fixed:** SIMP-2 replaces all 157 lines of `report.js` with
  `evals/results.malloy`. Folded into SIMP-2.

---

## Phase 2c — Simplification

*Mostly a side effect of EVAL-12, not a refactor for its own sake.*

The harness is ~10 files. About half of that complexity exists for ONE reason: it
grades a *trajectory* (free-form prose from a 20-turn subprocess) instead of a
*decision*. Both bugs found in review (EVAL-7 scope, EVAL-11 extraction) live in
exactly that code — they are the tax on the format, not sloppiness. Test at the
level where the messy code is unnecessary and it deletes itself.

**Do not do this as a standalone refactor.** SIMP-1 falls out of EVAL-12; the rest
are small and opportunistic. What exists works and just produced a real finding
about the protocol.

### Which Phase 2b work SIMP would have thrown away

Checked against the code, not assumed. The question "should we skip the EVAL fixes
if SIMP overwrites them?" is a good one, and the answer is: only twice.

- `report.js` (EVAL-13c) — SIMP-2 deletes the file. Not fixed; folded in.
- `extractNumber` (EVAL-11's second option) — SIMP-1 deletes the regex ladder, and
  EVAL-11's *first* option removed its last caller anyway. Not built.
- Everything else survives, because SIMP-1 does not delete `agent.js` — it narrows
  the blast radius to the ~5 tier-2 cases that still need a trajectory.
  `ALLOWED_TOOLS`, stamping, `compareResults`, the cross-checks and case validation
  are all on the surviving path. `compareResults` gets *more* load-bearing: tier 1
  grades on `must_use` / `must_not_contain` / query shape.
- AGT-3's `max_malloy_calls: 0` becomes structural rather than asserted — tier 1
  has no tools, and `refusal-routing-decision` is a tier-1 case by construction.
  The assertion stops costing anything to enforce.

### SIMP-1 · Decision-grading deletes the trajectory layer · SHIPPED as a lane, not yet as a deletion

**Trigger:** 2 of 6 cases on tier 1; correlation ESTABLISHED.

EVAL-12's tier 1 (one call, no tools, structured JSON out: "which concepts, what
Malloy?") removes the need for stream-json parsing, tool-call extraction,
authored-vs-trace splitting (`agent.js`) and the numeric regex ladder (`grade.js`)
on most cases — along with both bug classes above. Keep the full agentic path only
for the ~5 cases where multi-turn behaviour IS the test (self-verification,
projection, logging discipline).

**Shipped.** `evals/lib/tier1.js` + `tier:` on cases + `--tier` override. The seam
is the RUN SHAPE — tier1 returns the same object `agent.js` does, so `grade.js` and
every cross-check are untouched.

**Not yet done: nothing has been deleted.** `agent.js` and `extractNumber` still
stand. The first of the two conditions is now met — the correlation check
(EVAL-12d) reads ESTABLISHED on both tier-1 cases — but the second is not: 2 of 6
cases are tier 1, so the trajectory path is still the majority, and `agent.js` is
what tier 2 IS.

**What the correlation check licenses today is narrow and worth stating
precisely:** running those two cases cheap in a sweep. It does not license deleting
`agent.js` — tier 2 needs it, and the correlation check needs tier 2 to compare
against, so deleting it would delete the thing that validates the deletion.
`extractNumber` can go whenever someone wants, since EVAL-11 left it with zero
callers. Re-check correlation whenever a case moves to tier 1.

### SIMP-2 · Report in Malloy, not JavaScript · OPEN (opportunistic, small)

Results are JSONL; DuckDB reads JSONL natively; we own a semantic layer. Replace
`report.js` (~150 lines of hand-rolled grouping and diffing) with
`evals/results.malloy`: measures for pass_rate, flakiness, cost_per_case, flips by
category. Side effect: the agent can analyse its own eval history with the exact
tool under test — dogfooding, and one fewer bespoke reporter to maintain.

### SIMP-3 · One shared Malloy lib · DONE

`build.js` and `evals/lib/malloy.js` both implemented "compile every model, index
which file defines which source, run a query in the right model context".

**Shipped** as `malloy-lib.js` at the repo root, beside `okf-lib.js`: `newRuntime`,
`listModelFiles`, `definedIn`, `loadModelFile`, `buildSourceIndex`, `runQueryIn`.

What stayed with the callers is what they MEAN by the result — `build.js` keeps
concept annotations and referential validation; the harness keeps canonicalisation,
comparison and resolving which model a bare agent query belongs to. The harness's
public surface is unchanged, so `gold.js`/`run.js`/`grade.js` were untouched.
`build.js` also lost its second ad-hoc runtime (the coverage probe goes through
`runQueryIn`), and model files are now listed sorted so compile order is
platform-independent.

### SIMP-4 · Tier-0 checks fold into `build.js` · DONE

"Gold queries compile" and "every approved concept has a binding" is validation —
which is what `build.js` already is, and it already gates PRs (OPS-1).

**Shipped** as `evals/lib/goldcheck.js`, called from BOTH `build.js` and
`eval:gold --check`, so the gate and the standalone command cannot drift apart;
`gold.js` keeps only what is unique to it (WRITING `expect_value`). The source
index is assembled from the compile `build.js` already did, so tier 0 costs the
build nothing measurable.

**"Approved but unbuilt" promoted from warning to hard failure** — an approved
concept with no implementation is a governed definition the agent can route to and
then cannot answer from. Drafts exempt; nothing trips it today (55/55).

In `eval.yml` the separate `gold` job is gone, surviving as a pre-flight step in
the sweep job so a broken case still cannot spend a sweep. Both new failure modes
verified by deliberately breaking them.

### SIMP-5 · `selftest` becomes a flag, not a file · DONE

Shipped as `run.js --protocol <path>` (`evals/lib/protocol.js`), with the
control prompt promoted out of a JS string literal into a reviewable file,
`evals/protocols/stripped-analyst.md`. `selftest.js` went from 134 lines to ~90
and now holds only what is genuinely its own: which cases discriminate, and the
verdict. The backup file, the dirty-tree guard, the `finally` and the SIGINT
handler moved into the runner, which already owns everything else about a run's
lifecycle.

**The `--bare` question this section left open is answered: keep the swap.**
Both lanes DISCOVER `CLAUDE.md` from the working directory — tier 1 does it
exactly as tier 2 does, because "tier 1 differs from tier 2 in TOOLS and TURNS
and nothing else" (EVAL-12a) is what makes the correlation check a comparison
rather than two unrelated measurements. Injecting into one lane and discovering
in the other breaks that, and `--bare` additionally forces API-key-only auth,
which is fine in CI and breaks a local OAuth run. Nothing was worth that.

**A constraint that did not exist when this item was written.** EVAL-12b put the
protocol digest inside every `case_fingerprint`, and EVAL-6 already had it in
`semantic_identity`. So the swap MUST happen before either is computed —
otherwise a stripped-protocol run carries the shipped protocol's identity, its
rows sit in the ledger looking like evidence about the real product, and
`--select` is entitled to skip a real case on the strength of a run that
deliberately used the wrong rules. Ordering alone is not a guarantee, so
`assertActive` compares the identity's protocol digest against the file and
fails loudly; a mutation that moves the swap after the identity was confirmed to
trip it.

**Exit codes are now a taxonomy, and the selftest is why.** `0` all passed, `1`
a case failed, `2` nothing ran. The stripped phase EXPECTS failure, so "the
harness never ran" and "the cases failed" arriving as the same code would let a
run that never happened deliver exactly the answer that phase was hoping for.
Dirty `CLAUDE.md`, a leftover backup, a missing protocol file: all of them used
to exit 1.

**Other properties.** Results land in `evals/results/protocol/` and never stamp
`last_validated` (both for the same reasons EVAL-12d gave for the correlation
check). A leftover `CLAUDE.md.protocol-backup` refuses the run rather than being
overwritten — that file is somebody's real protocol and a new backup would
destroy the only copy.

**And the test that had to be fixed before it was worth having.** The wiring
test drives the real CLI down its crash path and checks the tree afterwards. Its
first version treated "the guard refused" as a reason to return early — and a
stray backup left by an earlier experiment sent it down exactly that path, so it
reported a pass while testing nothing, and a mutation that deletes the restore
went green underneath it. Now a leftover backup is a hard failure with
instructions, and the one legitimate blocked case (uncommitted protocol edits)
reports as SKIPPED rather than passed. Both mutations — dropping the restore,
and collapsing exit 2 into exit 1 — go red.

**Not verified live.** `npm run eval:selftest` has not been run against the new
path; it is ~4 tier-2 runs, $2-4. The mechanics are covered by 8 unit tests plus
the wiring test, and the swap/restore/identity/exit-code behaviour was driven
end-to-end through the real CLI with a stub agent — but whether the two
regressions still DISCRIMINATE is a claim about the protocol, not the harness,
and only a live selftest settles it.

### SIMP-6 · Snapshot + diff instead of authored assertions · OPEN (the out-of-the-box one)

**Trigger:** when hand-authoring toward ~30 cases starts to feel like the
bottleneck.

Replay-and-diff, not assert. Every `question-log.md` entry is already a real
question with a real answer and the concepts it used; promote human-accepted ones
into snapshots. The suite becomes: replay the last N accepted questions, diff each
new answer against its snapshot, show a human only what MOVED — with
`semantic_identity` saying whether the move was legitimate (a definition changed)
or a regression (nothing changed but the number did). No `expect_kind`, no gold
values, no extraction regex, no assertion vocabulary. The suite grows itself from
production, which is what EVAL-5 currently asks humans to do by hand.

**Caveats.** Snapshots enshrine yesterday's answer as truth, so only
human-ACCEPTED answers become snapshots and a filed correction overwrites one. And
diff the STRUCTURED part (concepts used, executed Malloy, headline figure), never
the prose, or the noise buries the signal.

**Keep assertion cases** for the handful of things worth pinning hard: refusals,
membership rules, the two known regressions.

---

## Phase 2d — OKF spec upgrade

*Triggered: a new Open Knowledge Format spec was published.*

**Status: not started.** Raised 2026-07-29 so it is not forgotten.

**Open question for whoever picks this up — the spec version and its published
location were not recorded when this was raised.** Get those first; everything
below is scoped from the CURRENT repo, not from the new spec, and the delta is
guesswork until someone reads it.

### OKF-1 · Pin the version we claim to conform to · 0.5 day

`kp/bundle.yaml` today is two lines — `namespace` and `temporal_anchor` — and
declares **no OKF version at all**. So there is no mechanical way to know which
spec the bundle targets, and no way for a build to notice it has drifted from one.
Add an explicit `okf_version:` (or whatever the new spec names it) and have
`okf-lib.js` assert it.

**Do this FIRST:** it is the check that makes every later spec bump detectable
instead of archaeological.

### OKF-2 · Read the new spec and diff it against the bundle · 0.5-1 day

Produce a written delta before changing anything: which frontmatter fields are
added, renamed, retyped or removed; whether folder tiering (`global/` vs domain)
still maps; whether `type`/`kind`, `status`, `preferred_source`, `allowed_roles`,
`last_validated` and the relationship model still mean what we use them to mean.

Output is a table of concept-file changes required, not a patch.

### OKF-3 · Migrate the bundle · 1-2 days

55 concepts + 6 relationships + `_templates/` + the operational docs under
`kp/agent/`. Mechanical where the delta is a rename; a decision where the spec adds
something we have been encoding by convention.

**Write it as a migration script, not by hand** — the same discipline as
`excel_to_okf.py`, and it keeps a rerun possible when the spec moves again.

### OKF-4 · Update the writers and validators · 1 day

`okf-lib.js` (loader + `writeBack`), `build.js` (validation + routing-table
generation), `excel_to_okf.py` / `okf_to_excel.py` (archived but still the OPT-6
revival path), `make_viz.py`, and `kp/_templates/`.

The routing table is GENERATED, so a frontmatter change ripples into `kp/index.md`
and every domain index automatically — but only if the generator knows about it.

### OKF-5 · Re-validate, and prove nothing moved · 0.5 day

`npm test` → `npm run build` (tree must stay clean) → `npm run eval:check`.

Then the part that actually matters: **`semantic_identity` will change**, because
`treeDigest` covers all of `kp/`, so an eval sweep after the migration will report
"the MEANING moved" (EVAL-6/EVAL-8). Run a sweep BEFORE and AFTER and compare
verdicts case by case — a pure format migration must not flip a single one. If it
does, the migration changed meaning, which is the whole risk.

**Why this is not just chores.** The KP's value proposition is that a definition is
governed and stable. A format migration is the one operation that can quietly
change what a definition MEANS while every gate stays green — the gates check
internal consistency, not fidelity to the previous semantics. The sweep comparison
in OKF-5 is the only thing that would catch it, which is a good argument for
getting more cases committed (EVAL-5) before starting.

---

## Phase 3 — Server adoption

*Publisher or Malloyyo; pick one.*

| Code | Item | Effort | Detail |
|---|---|---|---|
| INT-1 | `#(doc)` stamper in build.js | 0.5 day | For every `# concept`-annotated field, insert/refresh a `#(doc)` line from the KP definition (+ units, membership rules). Idempotent, regenerated per build. Governed definitions become the server's own discovery surface (getContext / describe_source). Runtime-independent — pays off regardless of pick. |
| INT-2 | CLAUDE.md → skill | 0.5 day | Reshape as `kp-analysis/SKILL.md` (also completes GOV-1). On Publisher it composes with their skills (theirs: query craft; ours: routing/governance); standalone elsewhere. |
| INT-3a | Publisher wiring | 1-2 days | `publisher.json`; flat layout; map `allowed_roles` → `internal:`/`private:`/required filters (or GOV-3 givens) + build check (declared vs enforced). |
| INT-3b | Malloyyo wiring | 1-2 days | `index.malloy`; `node build.js` as pre-push gate; define views for canonical questions (restricted-mode surface enforces "no invented joins" structurally). |
| INT-6 | Currency param → given | 0.5 day | Migrate `order_line_in_context(reporting_currency::string)` to `given: REPORTING_CURRENCY :: string is "USD"` — session-scoped by nature ("one value everywhere", per the givens doc's own criterion), removes instantiation syntax from the agent's world, aligns with Malloyyo's direction, valid on any runtime. Rule: every analysis-facing given carries a default (satisfiability). Do together with INT-3, whichever track. |
| INT-4 | claude.ai degraded mode | 0.5 day | Project knowledge = `kp/index.md` + skill (routing works); logs read-only there, or add GitHub MCP so log appends become commits. |
| INT-5 | Two-sided receipts | doc only | Server query logs (Malloy that ran) + question-log (question, concepts, method) = full provenance. Document the pairing; no new code. |

---

## Phase 3b — Bootstrap a new domain

*Agent-authored, human-ratified.*

| Code | Item | Effort | Detail |
|---|---|---|---|
| BOOT-1 | Conceptual doc → draft KP | 0.5 day | Skill/prompt: given a human-authored conceptual model (concepts, definitions, relationships) in any text form, emit an OKF bundle — files, frontmatter, folder tier, relationships, kebab URIs, from `_templates/`. Everything lands `status: draft` (only `approved` reaches the governed surface). Agent MUST output a confidence table flagging every definition where it filled a gap the source left open. Transcription, not invention. |
| BOOT-2 | KP + schema → Malloy scaffold | 2-4 days | From the bundle: entities → source stubs, `of:` → dimension placement, relationships → join stubs, measures → stubs — all pre-annotated with `# concept` (the annotation discipline is the forgettable part; generate it). Then, given the physical schema, the agent proposes bindings and measure expressions. Compile + cardinality probes (`join_one` vs `join_many`) + gold numbers verify the proposal. |
| BOOT-3 | Human ratification gate | process | What stays human: grain decisions, in-context source design, currency mechanics, choosing the authoritative table among candidates, and all approval. Agent authors both artifacts; agent approves neither (see LLM boundary). Draft → governed is steward review + gold-number verification, measured in days — that is the feature, not the bottleneck. |
| BOOT-4 | Bootstrap from reviewed dashboards | 2-3 days | Where a reviewed dashboard exists, reverse-engineer it: KPIs → measures, filters → defined classes, and its numbers are free gold answers for EVAL-1. Rank source queries by trust (dashboard-backed > one-off exploratory). Best entry point for a new enterprise domain with no modeling practice. |

---

## Phase 4 — Optional / triggered

*Not scheduled.*

| Code | Item | Trigger |
|---|---|---|
| OPT-1 | Adversarial review step — a reviewer sub-agent challenges final answers (Anthropic: +6% accuracy, +32% tokens, +72% latency) | evals plateau below target |
| OPT-2 | Standalone visualizer — self-contained `make_viz`, no knowledge-catalog clone; can style declared vs derived edges, statuses | graph becomes a regular business-review artifact |
| OPT-3 | Hierarchical bundle walk replaces read-whole routing table | routing table outgrows a single read (~hundreds of concepts) |
| OPT-4 | Coverage-warning tuning — flag only derived fields, not raw columns | already identified; fold into next `build.js` touch |
| OPT-6 | Excel authoring surface — REVIVED (v10) | Real steward pushback on editing markdown. `excel_to_okf.py` (archived, v5/v6) still works and preserves write-backs. **Hard rule if revived:** Excel becomes the SOLE write path for the frontmatter fields it owns — no mixed hand-editing, or the two paths silently fight. (0.5 day) |

### OPT-5 · Change classification + impact detection

**Trigger:** after EVAL-1.

Compare old vs new KP state and classify each concept change as IDENTICAL /
ADDITIVE / BREAKING / UNRELATED — derivable from frontmatter: a synonym added is
additive; `membership_rule`, `definition`, `of`, `preferred_source` changed is
breaking. CI gates BREAKING hard and lets ADDITIVE through; BREAKING re-runs
affected evals (via `must_use`). Beats a raw diff, which cannot tell the two apart.

### GOV-3 · RLAC via inline givens + `finalizeGivens`

**Trigger:** the first concept whose `allowed_roles` actually matters.

`##! experimental.givens`: the host supplies CAPABILITIES; `inline CAN_READ_X ::
boolean` gates sensitive sources; `finalizeGivens` blocks per-query override — the
agent becomes an untrusted caller that cannot bypass the gate. Runtime-neutral
(works via `malloy-config.json` on local MCP too), so it supersedes waiting for
Publisher's `private:`. Build check: every `allowed_roles` concept maps to a gated
source. The feature is experimental; re-verify syntax at build time.

### GOV-4 · Per-user context personalization (aliases + defaults)

**Trigger:** after EVAL-1, so alias impact on resolution is measurable — and real
demand for user/team vocabulary.

Let a user personalize the **resolution** layer only, NEVER the **definition**
layer. A typed operational doc (`type: profile`, one per user, e.g.
`kp/agent/profiles/<user>.md`) carries:

- **aliases** mapping the user's own vocabulary to an existing approved URI
  (`GMV -> kp:TotalSales`, `contribution -> kp:Margin`), and
- **defaults** for knobs that already exist (default domain lens for ambiguous
  labels, currency/units, receipt verbosity).

The agent expands aliases at routing time BEFORE matching the routing table. It
reuses machinery that already exists: aliases are the ungoverned per-user
counterpart of the governed `synonyms` field.

**DO.** Validate every alias target resolves to an `approved` URI — a deterministic
build check, same discipline as `# concept` / `preferred_source`; an alias to a
non-existent concept goes to the gap-log, not to a silent new meaning. Disclose
alias use in the AGT-1 answer receipt (`resolved "GMV" -> kp:TotalSales via your
profile`). On collision with a governed label or synonym, **governed wins** and the
agent states which it applied (same rule as global-vs-local). Add a "shared
aliases" report so an alias many users independently add becomes a reviewed PR that
promotes it into the concept's governed `synonyms` — mirroring the domain→global
promotion path, so personal context becomes a harvesting ground for governed
vocabulary, like the gap-log.

**DO NOT.** Let a profile carry a definition, membership rule, threshold, filter, or
binding — that is a plural/shadow definition, an explicit non-goal. A user who wants
a genuinely different meaning gets a NEW distinct URI via the draft→approve path,
not a personal override. And do not let the profile become a per-user KP fork: it
only POINTS AT governed concepts, never redefines, filters, or forks them.

**Net effect:** personalization changes what the agent understands *from that user*,
never what it computes or what others see — a lens, not a lever. Fits the LLM
boundary: the agent proposes aliases and promotions, the build validates, humans
ratify.

---

## Decided — do not relitigate

### Explicit non-goals

No context platform purchase; no dependency graph beyond references; no
federated/plural definitions; no TMDL/DAX emitter; no join map in the routing table
(servers' `describe_source` covers it); no vector/RAG retrieval over the KP.

### LLM boundary

The agent may propose intent, analyses, and candidate meaning (gap-log entries,
question-log, correction reports, draft concepts). Every *trust* decision —
validation, compatibility classification, coverage, drift, eval scoring — is a
deterministic artifact checked mechanically by the build. No trust decision is ever
delegated to a model.

### Givens usage rule

Givens are for what the agent must NOT control (tenancy, roles, row caps —
finalized), with defaults on everything else; plain `where:` remains the agent's
tool for everything it freely explores. Do not parameterize exploration.

---

## Lessons that keep coming back

### The EVAL-8 shape

*A flag and a hash disagreeing about the same tree — a check that reports one
thing while the mechanism it describes does another.* It has now appeared four
times: the original `gitDirty` bug (EVAL-8), the correlation check printing
`VERDICT: ESTABLISHED` while exiting 1 (EVAL-12d), a 529 scored as a product
failure (EVAL-14), and a `usage` breakdown disagreeing with the total it breaks
down (EVAL-12c). Expect it again.

**The test-level corollary:** every unit test written for EVAL-8 passed against
the broken code, because they exercised `treeDigest` and not the flag. A helper
test is not a wiring test.

### Two lessons from building the correlation check

1. **The check has to be able to say "I did not measure that."** Every early
   version of the verdict logic had exactly two outcomes, agree and disagree, and
   both real failure modes it hit on day one — a lane below quorum, and two lanes
   at different semantic identities — are neither. A comparison that cannot report
   "nothing was compared" will report a disagreement instead.
2. **A verdict line that contradicts its own exit code is a bug, not a formatting
   nit.** The first CLI run printed `VERDICT: ESTABLISHED` and exited 1, because
   the provenance guard lived in the printer instead of in the tested function.

### Two lessons from EVAL-12c, both about measurement rather than caching

1. **A cost figure taken from run 1 is a measurement of the COLD path.** The ~1-day
   Batch-API item existed because a single run's usage breakdown was read as
   representative, and run 1 is the one run in a sweep that is guaranteed not to
   be. The fix was to read the rows already sitting on disk — the evidence had been
   paid for and never looked at. Before building against a cost premise, check
   whether the sweep already answered it.
2. **The EVAL-8 shape, caught this time in the test itself.** The first version of
   the usage test exercised `addUsage` and passed cleanly when the line that CALLS
   `addUsage` was mutated back into the bug. `askTier1` grew a `call` seam so the
   loop could be driven with a fake, and both mutations now fail the suite. Every
   claim in EVAL-12c's section was checked by breaking the code and confirming a
   test went red.

### The tier-1 criterion, learned by getting it wrong

`membership-verbatim` was declared tier 1 and moved back to tier 2. With only the
routing table the agent wrote `aggregate: is_active_customer`, but that binding is
a BOOLEAN measure (`made_an_order.count() {...} > 0`), so aggregating it at the top
grain asks "did anyone order?" instead of "how many customers are active". It RUNS,
so no compile-repair round can catch it — it is a wrong decision and was graded as
one. Reaching the right grain needs the measure's TYPE, which lives in the source,
not the table.

**Tier 1 is for bindings you can aggregate directly; anything whose grain or type
must be inspected stays tier 2.** Expect this to put fewer than the hoped ~25 of 30
cases in the cheap lane.

### A mechanism that decides what NOT to measure must fail toward measuring more

From EVAL-12b. Impact selection is the first thing in this repo whose failure
mode is *silence*: a wrongly skipped case produces no row, no verdict and no
red, so nothing about it is visible in any report. Everything about the design
followed from choosing the direction it breaks in — an undeclared dependency
pays full price, a fingerprint that fails to get written makes the feature do
nothing rather than skip wrongly, and a skipped case is never a result row so it
can never become evidence about itself.

The same instinct also says which input NOT to hash. The routing table is what
the agent reads, so digesting `kp/index.md` looks obviously right — and it would
have made every definition edit select every case, i.e. a mechanism that always
returns "measure everything" while looking like it was doing something. It is a
*projection* of the concept files, not an input. **Fingerprint the sources, not
the generated view of them.**

### "Closed in one dimension" is not closed

EVAL-9 was fixed in the row dimension, verified, and shipped — and the identical
hole survived in the column dimension for another day, live on both scalar-gold
cases. When a fix is about a *class* of laxity, enumerate the dimensions it can
appear in before calling it done.

**Third instance, EVAL-12b.** The warm-then-fan-out rule was written, reviewed
and unit-tested against the *run* dimension: job 0 runs alone so the sweep pays
one cache creation. It shipped blind to the *case* dimension, where the prompt
has a second cached block, and the first live run started two runs of the same
case together and paid for that block twice. Both times the fix was correct as
far as it went, and "as far as it went" was the bug.

**And the corollary about how it was caught:** only a live run could catch it.
Every unit test agreed with the code, because the code did exactly what the
tests and the author both believed the rule was.
