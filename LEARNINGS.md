# Learnings & detailed work log — Knowledge Plane + Malloy models

This file holds the detailed reasoning, evidence, and history behind the
roadmap. **[ROADMAP.md](ROADMAP.md)** carries the current status, the gates, and
the compact list of items; each item's full write-up — why it was built, what it
found, how it was validated — lives here under its stable code (`EVAL-8`,
`SIMP-1`, `OKF-6`, …), which commits and code comments cite. Finished items keep
their full detail on purpose: the reasoning behind them is cited constantly by
later work.

**What's here:** the completed phases (1, 2, 2b, 2c, 2d) in full; detailed
design notes for the planned/triggered items (HIER-1, OPT-5, GOV-3, GOV-4); the
"Decided — do not relitigate" record; and the cross-cutting "Lessons that keep
coming back".

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
| EVAL-5 | Seed from real usage | **closed (2026-08-07)** | 9 cases harvested 2026-08-06, committed on `eval-5-harvest` 2026-08-07 (`71f03e2`, `dbee9f0`, `dc95586`); all 9 resolved — 8 discriminating + 1 exempt (`refusal-returns-not-in-data`). Found EVAL-15/16/17/18 and EVAL-19 (five real selftest-harness bugs) along the way. Initial-backlog harvest done and source logs drained; ~30 target retired (it was a volume aspiration, not a bar). Further cases arrive via the standing correction→case pipeline, not a reopened task. See EVAL-5's section for the harvest and EVAL-15 onward for the bugs. |

### EVAL-5 · Seed from real usage · CLOSED 2026-08-07 — 9 cases harvested 2026-08-06, all 9 resolved (8 discriminating + 1 exempt); initial backlog drained, ~30 target retired, further cases via the standing correction→case pipeline

**Count corrected below.** This section's first pass counted all 9 as headed
for 16 of ~30 the moment they went green; three of them only went green
because of the leak EVAL-18 describes, not because the case discriminates.
Six are confirmed as of the 2026-08-06 re-audit (`contoso-vs-third-party-brand`,
`best-customer-ranking-criterion`, `market-basket-fabrikam-laptops`,
`top5-customers-category-nest`, plus `refusal-returns-not-in-data` exempt and
`bike-name-match-contamination` pending one confirming rerun); three
(`discount-band-per-order`, `north-america-qoq-channel`,
`online-delivery-delay-by-country`) are not yet real evidence. The count in
the roadmap's commit history (EVAL-12c's own lesson) is: read it from what was
actually measured, not from what a sweep merely finished running.

**Branch `eval-5-harvest`, uncommitted as of 2026-08-06.** 9 new case files
written to `kp/agent/evals/` and pass `npm run eval:check` (tier-0, gold
compiles). Live `eval:selftest` audit run against all 9 — verdict below.
Nothing here is committed yet; pick up on that branch.

**Where the 9 came from** (harvest priority per this section: known
regressions → question-log → corrections, exactly as below):

| Case file | Source |
|---|---|
| `bike-name-match-contamination.md` | `corrections.md` 2026-08-04 |
| `best-customer-ranking-criterion.md` | `corrections.md` 2026-08-05 |
| `north-america-qoq-channel.md` | `question-log.md` + `gap-log.md` |
| `online-delivery-delay-by-country.md` | `question-log.md`, exercises the StoreCountry/Online standing hint |
| `discount-band-per-order.md` | `question-log.md`, regression guard for the resolved OrderKey-internal bug |
| `top5-customers-category-nest.md` | `question-log.md` |
| `market-basket-fabrikam-laptops.md` | `question-log.md` |
| `contoso-vs-third-party-brand.md` | `question-log.md` |
| `refusal-returns-not-in-data.md` | `gap-log.md` |

**Selftest verdict (2026-08-06, `selftest-harvest.log` in repo root,
uncommitted):** 1 of 9 discriminates cleanly. Read that number carefully —
**every real-protocol answer observed was actually correct and well-reasoned.**
The failures are case-authoring bugs and one harness bug, not a product
regression. Full per-case breakdown:

| Case | Verdict | What's actually wrong |
|---|---|---|
| `contoso-vs-third-party-brand` | **OK — ship it** | stripped=fail, real=pass. Solid. |
| `bike-name-match-contamination` | Inconclusive | `query_shape` matched gold exactly on both real-protocol runs; `expect_receipt` reads `false` but the stored `agent_answer_excerpt` is hard-truncated at exactly 1200 chars mid-receipt (`run.js:404`), cut off right after `**UNGOVERNED**...grouped by kp:Customer (governed) and ranked `. Cannot confirm without a live rerun with a longer excerpt or a look at the untruncated `run.answer` the grader actually used. |
| `north-america-qoq-channel` | My bug | Correct final answer (used `kp:CustomerCountry`, explicitly cited the StoreCountry standing hint) — but an early *verification* query (checking that `StoreCountry` really is degenerate for Online orders, exactly the diligence the standing hint calls for) got EXECUTED, not just compiled, and `must_not_contain` matches any executed query. Fix: narrow the pattern to the final query only, or drop it and rely on the `analysis` cross-checks + receipt. |
| `online-delivery-delay-by-country` | My bug | Same pattern as above — correct final `query_shape` match at `subset` tier, verification step flagged. |
| `market-basket-fabrikam-laptops` | My bug | Agent explicitly said "there's no single product literally named 'Fabrikam Laptops' — it's a brand+subcategory match" (exactly correct) but then used the phrase in prose as natural-English shorthand, which is what `must_not_contain: ["Fabrikam Laptops"]` was matching. Fix: match the actual misuse pattern (`= 'Fabrikam Laptops'`), not the English phrase. |
| `best-customer-ranking-criterion` | **Harness bug** | Stripped-protocol agent (17 tool calls, only 3 Malloy) read `kp/agent/corrections.md` directly off disk and found the 2026-08-05 correction, which states the answer almost verbatim including the literal word `UNGOVERNED`. Passed stripped protocol on content it wasn't supposed to have. |
| `discount-band-per-order` | **Harness bug (same root cause)** | Passed stripped with a full receipt and correct banding logic a stripped prompt has no way to produce on its own. |
| `top5-customers-category-nest` | **Harness bug, confirmed** | Stripped-protocol answer literally says: *"this repo's CLAUDE.md is currently a stripped-down scratch version (uncommitted), with the real Knowledge Plane protocol sitting in CLAUDE.md.protocol-backup. I used the real protocol... since that reflects the actual governed setup."* |
| `refusal-returns-not-in-data` | Not a bug — needs an EXEMPT entry | Data absence (no returns table/field/proxy anywhere) is verifiable independent of governance, same class as the existing `refusal-routing-decision` exemption in `selftest.js`. Add it to `EXEMPT` with its reason rather than trying to make it discriminate — it structurally can't. |

### EVAL-15 · Selftest `--protocol` swap leaks the real protocol via the backup file · DONE

**The bug.** `run.js --protocol <path>` (SIMP-5) swapped the real `CLAUDE.md`
out to `CLAUDE.md.protocol-backup` in the repo root for the duration of a run
and restored it after (`finally`/SIGINT/SIGTERM/crash). `docs/evals.md`
documented a guard against a *leftover* backup from an interrupted prior run —
but nothing hid the backup file *during* an active run, and the agent under
test has `Read`/`Glob` available (`DISALLOWED_TOOLS` in `evals/lib/agent.js`
is only `['Write', 'Edit', 'NotebookEdit', 'Bash']`). An agent that lists the
repo root during a stripped-protocol run could simply read the real protocol
back out of the backup file and follow it — confirmed directly in the
`top5-customers-category-nest` trace above.

**Why this matters beyond the 9 cases.** Every prior `eval:selftest` run that
used `--protocol` (which is how BOTH phases of every selftest run — including
the two default `REGRESSION_CASES` that gate every PR — work) had the same
opportunity to leak. This is the same class of bug as EVAL-8 and EVAL-14: the
harness silently not testing what it claims to.

**Fix, shipped.** `evals/lib/protocol.js`: `defaultBackupFile()` now resolves
to `os.tmpdir()` keyed by a hash of the protocol file's own resolved path —
outside the tree the agent explores, but stable across runs of the same repo
so a leftover backup from a crashed run is still findable by `guard()`.
`swapIn`/`guard` default to it; the old `CLAUDE.md.protocol-backup` literal is
gone from `protocol.js`, `docs/evals.md` and the crash-recovery test (which
now asserts against the computed path, not a hardcoded one). Pinned by two new
unit tests (the default path is outside the protocol file's directory; it's
stable across calls) plus the existing crash-recovery wiring test, updated to
match.

**Confirmed live, 2026-08-06.** Re-running the audit after the fix flipped
`top5-customers-category-nest` and `discount-band-per-order` to correctly
FAILING the stripped phase (previously they passed by reading the leaked
backup). `best-customer-ranking-criterion` still passed stripped — a
*different* leak, closed separately by EVAL-16 below.

### EVAL-16 · Stripped-protocol control doesn't hide the operational docs · DONE

**The bug.** Swapping `CLAUDE.md` (EVAL-15) is not enough: CLAUDE.md itself
tells the agent to consult `kp/agent/corrections.md` ("check Standing hints
before answering") and `kp/agent/examples.md` ("copy these query shapes") —
EVAL-12b's own `case_fingerprint` reasoning already treats them as "standing
hints the agent acts on." They sit in the working tree with plain Read/Glob
access regardless of which `CLAUDE.md` is in force, so a stripped-protocol run
that only swaps `CLAUDE.md` leaves the real, governed answers one Read call
away. Confirmed live: a stripped run answered `best-customer-ranking-criterion`
almost verbatim off `corrections.md`, including the literal word `UNGOVERNED`
from the 2026-08-05 correction entry.

**Fix, shipped.** `evals/lib/protocol.js`: `hideOperationalDocs()` moves
`corrections.md`, `question-log.md`, `gap-log.md` and `examples.md` aside for
the duration of a `--protocol` run, using the same backup-path scheme as
EVAL-15 (`hideFile`, built on `guard`/`defaultBackupFile`). Guards every file
BEFORE hiding any of them, so a problem on the third file cannot leave the
first two already moved aside with no restore triggered. `run.js` composes it
with the CLAUDE.md swap at the same point (before identity is computed, so
the identity correctly reflects their absence too) and restores both together
on exit/crash/signal. Five new unit tests, plus the crash-recovery wiring
test extended to check all four docs come back byte-identical after a crash.

**Confirmed live, 2026-08-06.** `best-customer-ranking-criterion` now
correctly fails the stripped phase and passes the real one.

### EVAL-17 · Receipt detection missed markdown and cross-turn commitments · DONE

**Two bugs found auditing `bike-name-match-contamination`,
`discount-band-per-order` and `north-america-qoq-channel`'s real-protocol
runs, both in `expect_receipt` grading (`grade.js`), neither in the product.**

1. **Markdown broke the regex.** `RECEIPT_RE` (`/basis\s*:.*\|\s*freshness\s*:/is`)
   only allows whitespace between `|` and `freshness` — but a receipt written
   as CLAUDE.md's own examples format it, `**Basis:** … | **Freshness:** …`,
   puts markdown emphasis there, which a genuinely correct receipt was graded
   as missing for. Fixed by stripping `*_\`` before matching (`stripMarkdownEmphasis`)
   rather than special-casing markup into the regex — a receipt should be
   graded on its content, not its formatting.
2. **The final CLI message is not always the substantive answer.** CLAUDE.md
   requires a post-answer `question-log.md` write; the eval sandbox
   deliberately denies `Write`/`Edit` (so a sweep can't dirty the tree); an
   agent that tries anyway sometimes spends its LAST turn apologising for the
   blocked write instead of restating the receipted answer it already gave —
   orphaning a correct receipt one turn back. `run.answer` (the CLI's last
   `result` message only) missed it.

**First fix over-corrected, and the re-audit caught it.** Checking one
concatenated blob of every turn's prose (`authoredText`) for a receipt fixed
(2) but reopened a worse hole: `RECEIPT_RE` is unanchored and dot-all, so
"basis" surviving from one turn and an unrelated "freshness" several turns
later (with some stray markdown-table pipe sitting between them) could combine
into a receipt that was never actually written. This is not hypothetical — it
looked, at first, like exactly what had happened to three cases that started
passing the STRIPPED protocol on the very re-audit meant to confirm EVAL-15/16
(see EVAL-18: the real cause turned out to be different, but the risk in the
grading logic was real regardless and is fixed on its own merits).

**Fix, shipped.** `agent.js`'s `extract()` now returns `textParts` (already
computed internally, previously not exposed). `grade.js`'s `receiptPresent(run)`
checks each assistant message independently — broad like `must_use` (a receipt
in any turn counts, not just the last), but never stitched across turns like
the bug above. Six new unit tests, including one that pins the false-positive
specifically: a "basis" in one message and an unrelated "freshness" in another
must NOT combine into a passing receipt.

### EVAL-18 · The stripped-protocol control doesn't hide `kp/agent/evals/` itself · DONE 2026-08-07 (cases moved to `evals/cases/`; re-audit confirmed, relocation alone sufficient)

**The bug.** Re-running the selftest audit after EVAL-15, 16 and 17 shipped,
three cases still passed the STRIPPED protocol:
`discount-band-per-order`, `north-america-qoq-channel`,
`online-delivery-delay-by-country`. The receipts they produced were
genuine — correctly formatted, well-reasoned, present in a single message —
so this is not a grading artifact (EVAL-17's fix was real and worth keeping,
but it did not cause this). Reading the `discount-band-per-order` transcript
found the actual cause, stated by the agent itself:

> "The discount-band eval regression case (`kp/agent/evals/discount-band-per-order.md`)
> covers exactly this question, so I followed its gold pattern."

**`kp/agent/evals/*.md` case files are themselves readable by the agent under
test**, via the same plain `Read`/`Glob` access EVAL-15 and EVAL-16 already
had to route around — and each one documents its question, its exact correct
`gold_query`, and prose reasoning about why the answer is governed/ungoverned.
For any case whose own case file states the answer (which is most of them, by
construction — that is what a case file is for), a stripped run can simply
read its own answer key instead of reasoning about governance at all. This
explains all three "false pass" cases at once, and neither EVAL-15's nor
EVAL-16's fix touches `kp/agent/evals/`.

**Why this is bigger than a selftest fix.** EVAL-15 and EVAL-16 are both
scoped to "the stripped-protocol CONTROL leaks the real protocol" — fixable
by hiding specific files during a `--protocol` run. EVAL-18 is different in
kind: `kp/agent/evals/` is not something only the stripped control needs
hidden — it's a directory a REAL, ungated tier-2 session (the actual product,
not just the selftest) could equally read if a question happened to resemble
one already logged as a case, independent of `--protocol` entirely. Whether
the right fix is selftest-scoped (extend `hideOperationalDocs` to the whole
`evals/` directory during a `--protocol` run) or harness-wide (something in
`DISALLOWED_TOOLS`/sandboxing, or moving case files outside the `kp/` tree the
agent is meant to explore) is a real design decision, not a quick patch, and
is exactly why this was stopped here rather than patched immediately.

**Also unresolved from the same audit:** `bike-name-match-contamination`'s
real-protocol run scored a query_shape MISMATCH (`none`, below `min_match`) —
a reversal from two prior runs that matched `exact`. Single run, quorum 1;
status unclear (sampling variance vs. a real regression) until a confirming
rerun.

**Scope decided (2026-08-07): harness-wide.** The selftest-scoped option (hide
`kp/agent/evals/` only during a `--protocol` run) fixes the CONTROL but leaves
the same hole in the REAL tier-2 measurement — a live, ungated session pointed
at `kp/` (CLAUDE.md's "What you have") could read a case file whose question
resembles the one asked and pass for the wrong reason. Relocating the case
files out of the `kp/` tree the agent explores closes both at once and subsumes
the selftest fix, so there is nothing left to hide.

**Fix, shipped (code) 2026-08-07.** All 16 case files moved
`kp/agent/evals/*.md` → `evals/cases/*.md` (7 via `git mv`, 9 uncommitted
harvest cases via `mv`). `EVALS_DIR` default in `cases.js` re-pointed;
`okf-lib.js` drops the `[evals]` link from the generated routing-table footer
(so `kp/index.md` no longer advertises the answer keys); `run.js`,
`test/unit.test.js` (three loadCase paths), `CLAUDE.md` (both the "What you
have" listing and the leaf-scoped "What you may write" rule — `evals/cases/`
is the sole writable exception under otherwise-never-write `evals/`),
`ARCHITECTURE.md`, `README.md`, `docs/evals.md`, `PHASE2_SPEC.md` all updated.
Side effect, intended: case files leave `semantic_identity` (`treeDigest`
walks `kp/` only), so a case edit no longer invalidates every case's
skip-cache — it was the EVAL-12b "one size too large" shape and is now gone;
`case_fingerprint` still tracks each case via its `_path`. Gates green:
`npm test` 103/1-skip (the skip is the crash-recovery test self-protecting on
a dirty CLAUDE.md), `npm run build` clean (16 cases resolve at the new path,
0 concept files touched), `npm run eval:check` gold current.

**No hiding machinery was added, deliberately.** Whether relocation ALONE makes
the stripped control fail (vs. still needing `evals/cases/` hidden during a
`--protocol` run, because a stripped agent Globs broadly) is an empirical
question the live re-audit answers — building the hide before measuring would
be the EVAL-12c anti-pattern (machinery against an unmeasured failure mode).
Residual, stated honestly: the move relocates the bait off the explore surface
but is NOT a hard sandbox — a Glob-happy agent could still reach `evals/cases/`.
A true guarantee is `DISALLOWED_TOOLS`/path-restriction, left as a separate
future item.

**Re-audit CONFIRMED (2026-08-07)** — evidence:
`evals/results/selftest/2026-08-07T10-*.jsonl` (8 tier-2 runs). The three
formerly-blocked cases now discriminate cleanly, so relocation ALONE was
sufficient and no hiding machinery was needed:

| Case | stripped | real | verdict |
|---|---|---|---|
| `discount-band-per-order` | fail | pass | OK — discriminates |
| `north-america-qoq-channel` | fail | pass | OK — discriminates |
| `online-delivery-delay-by-country` | fail | pass | OK — discriminates |

The stripped phase now correctly FAILS (the answer-key leak is closed); every
stripped run flagged `missing AGT-1 provenance receipt`, which is the honest
floor for a no-protocol control. Committed as `71f03e2` on `eval-5-harvest`
(the move + EVAL-15/16/17 code + the 9 harvest cases). Remaining harvest work:
continue toward ~30 from the remaining `question-log.md` entries (Home
Appliances discount/margin question and its control variant identified, not yet
authored).

**One holdout, and it is a GRADING fragility, not a product error:
`bike-name-match-contamination` scored `stripped=fail, real=fail`** on this
re-audit (quorum 1). NOT an EVAL-18 problem. Root-caused by re-executing the
agent's own query locally (Malloy, no LLM) — **the agent's answer is correct**:
its top-5 customers and revenues are IDENTICAL to gold (Spencer Spencer
$548.69 … Harvey Barnes $506.12). The initial "wrong measure / overcount"
reading was WRONG — `total_sales { where: …bike… }` compiles to a line-grain
`SUM(CASE WHEN …bike… THEN Quantity*NetPrice*Exchange)`, mathematically equal
to `kp:LineRevenue`; no overcount. It fails `query_shape` for two independent,
presentation-only reasons:

1. **Nesting (EVAL-19).** The agent wrapped the top-5 in a `nest:` alongside a
   summary, so its result is ONE row with a nested array; gold is 5 flat rows.
   `compareResults` (`evals/lib/malloy.js`) only ever compares top-level rows —
   it never descends into a nested array column. A real grader gap, logged as
   EVAL-19 below.
2. **Projection.** Even flattened, the agent identifies customers as
   `concat(GivenName,' ',Surname)` + revenue (2 cols); gold pins `CustomerKey`
   + `GivenName` + `Surname` + revenue (4 cols). No tier bridges that: `values`
   needs equal per-row value multisets, `subset`/`containsAll` needs
   agentCols ≥ goldCols. So fixing EVAL-19 alone would NOT make this run pass.

Earlier runs scored `exact` by returning a flat table with gold's exact
columns — so the variance is PRESENTATIONAL, not correctness. This is the
EVAL-11 tension (query_shape is brittle to a legitimately-different
presentation of a correct answer).

**RESOLVED 2026-08-07** (revenue-robust gold + EVAL-19 + dropped
`must_not_contain`). The fix came in three layers, each only visible once the
one above it was peeled, across four live selftest runs:

1. **Gold re-targeted to the five revenue VALUES** (`select: bike_revenue` off
   the top-5, `min_match: subset`). Projection-robust: the contamination changes
   the figures entirely (camera-dominated, larger → `none`), while a correct
   answer passes however it labels or nests its customers. Revenues are
   customer-specific, so the right five imply the right five customers.
2. **EVAL-19** so `query_shape` descends into the agent's `nest:`. Together with
   (1), every observed correct answer scored `subset`.
3. **`must_not_contain` on `'%ike%'` DROPPED.** `scope: final` was tried first
   (excludes the verification query) but a later run put the pattern in the
   ANSWER PROSE ("I avoided `~ '%ike%'`…"), which no scope excludes. The guard
   is redundant — query_shape already catches the contamination via wrong
   revenues, and `expect_receipt` is the reliable discriminator (both stripped
   runs produced no receipt; both real runs did). Regression coverage is now
   query_shape + `expect_receipt` + `must_use`.

**Evidence — four runs, real pass ×2 / stripped fail ×2** (once
`must_not_contain` is removed): real #1/#2 both `query_shape: subset` +
receipt; stripped #1/#2 both missing the AGT-1 receipt (and #2 also `none`).
Not re-run live after dropping the guard — the four runs already isolate every
check's behaviour, and re-running would only re-observe it (do NOT
rerun-until-green). Results:
`evals/results/selftest/2026-08-07T13-*.jsonl`.

### EVAL-19 · `query_shape` grading never descends into a nested result · DONE 2026-08-07

**The gap.** `compareResults` (`evals/lib/malloy.js`) compares only the
top-level rows of the agent's result against gold. When the agent returns a
Malloy `nest:` — e.g. `[{ summary…, top_customers: [ …5 rows… ] }]` — the
nested array is a legitimate result set the agent computed, but the comparison
sees one row with an opaque array value and scores `none`. Confirmed on
`bike-name-match-contamination`'s real run: the nested `top_customers` array is
byte-identical to the 5-row gold, yet the case scored `none`. Same class as
EVAL-9 (grader unsound against a legitimate answer shape), one dimension over:
EVAL-9 was extra COLUMNS, this is a nested ROW SET.

**Fixed.** `evals/lib/malloy.js` gained `candidateRowSets(rows)` (the top-level
rows plus, for each column holding arrays of objects, the flattened nested row
set — one level deep) and `bestMatch(agentRows, goldRows)` (strongest tier over
those candidates, ranked so a new `compareResults` tier can't fall through).
`gradeQueryShape` (`grade.js`) now calls `bestMatch` instead of `compareResults`.
False positives are still bounded by `containsAll`'s anchoring. Five unit tests
pin it, including the two that matter: a nest equal to gold matches at its
natural tier (the bike-name shape → subset), and a nest that does NOT equal gold
still scores `none`. As predicted this did NOT by itself fix `bike-name` (that
run also differed in projection, and later in `must_not_contain` scope — see the
bike-name entry), but nested presentations are common and correct, so it is
worth having regardless.

---

### EVAL-5 (original write-up, 2026-08-03) · Seed from real usage · BLOCKED on real usage (7 of ~30 cases)

**The harvest sources are empty, and that is the finding.** EVAL-5's rule is
*harvest, don't invent*, and its three sources say this on 2026-08-03:

| source | entries |
|---|---|
| `kp/agent/question-log.md` | 0 |
| `kp/agent/gap-log.md` | 0 |
| `kp/agent/corrections.md` | 0 corrections, 1 standing hint |

So the backlog this item is supposed to draw from does not exist yet. The plane
has not been used by anyone whose questions were logged — every case in the
suite came from the two known regressions or from reviewing sweeps.

**One item WAS available and is now harvested.** `standing-hint-window`
(`contains`, tier 2) tests the standing hint in `corrections.md`: the
`kp:ActiveCustomer` measure compiles "last 2 years" against `LOCALTIMESTAMP`, so
the agent must state the window it actually applied. CLAUDE.md tells the agent
to check standing hints before answering, and `corrections.md` sits inside the
semantic identity precisely because editing it can move an answer — but nothing
asserted that the pathway works. Now something does. Audited on arrival:
`stripped=fail, real=pass`.

**Its assertion was measured, not guessed**, which is the transferable part.
Every candidate phrase was scored against the 10 recorded runs of that question:
`wall clock` appears in 7/7 correct answers and 0/3 incorrect ones, while
`2024-04-20` appears in 7/7 correct AND 2/3 incorrect — because the two wrong
answers state the window is "anchored to the data's max order date, not today",
the exact inversion of the defect, while quoting the right date. A check on the
date would have passed an answer that says the opposite of the truth. **The
recorded results are a corpus for authoring assertions, and using them costs
nothing.**

**What would actually unblock this.** Not more invention — the last three days
found two of six existing cases testing nothing while looking thorough, and
invented cases are exactly the ones most likely to assert what the author
imagines instead of what goes wrong. The options, in order of value:

1. **Use the plane for real work and let the logs fill.** The intended path.
   Every novel analysis logged is a candidate; every correction filed is a
   regression case with its corrected result as gold.
2. **Review the ~50 recorded agent runs for silent wrongness.** They are real
   behaviour under the real protocol and nobody has read them for correctness,
   only for verdicts. A wrong answer that PASSED is the highest-value case there
   is, and it would be free to find.
3. **Mine `question-log.md`'s intent by asking the models what they can answer**
   — weakest, since it invents questions, but it at least targets real bindings.

**Standing rule for every case added from here:** run
`npm run eval:selftest -- --case <name>` before counting it as coverage. A case
is a claim until it has been audited; two of six were claims.

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

### EVAL-13 · Minor harness fixes · DONE

- **`ALLOWED_TOOLS` omitted `mcp__claude_ai_Malloyyo__query`** although `RUN_TOOLS`
  recognises it, so Malloyyo runs would be blocked at the tool gate. **Done**,
  together with `describe_source` / `list_sources`: CLAUDE.md requires
  inspect-before-run, so allowing the query alone leaves the runtime broken a
  different way. A test now asserts every `RUN_TOOL` is allowed at the gate.
- **`--live` still stamped `last_validated` from non-fixture data.** **Done** —
  suppressed unconditionally under `--live`, including against an explicit
  `--stamp`, and announced in the summary.
- **`report.js` splits one diagnosis sentence across two `if` chains.**
  **Deliberately NOT fixed; closed by deletion.** SIMP-2 replaced the reporter's
  grouping and diffing with `evals/results.malloy`, and the two `if` chains went
  with it. Folding it in was the right call: the fix would have been rewritten
  three weeks later by the item that removed the file.

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

### SIMP-2 · Report in Malloy, not JavaScript · DONE

Results are JSONL; DuckDB reads JSONL natively; we own a semantic layer. So
`report.js` (172 lines of hand-rolled grouping and diffing) became
`evals/results.malloy` plus a 110-line printer with a `--view <name>` escape
hatch. Measures for pass rate, flakiness, cost, cache share, provenance and
flips; the side effect was the point as much as the deletion, since the agent
now analyses its own eval history with the exact tool under test.

**The bigger half was not the deleted lines, it was the duplicated rule.** The
old reporter re-implemented run.js's quorum, so "what counts as a passing run"
existed twice and could drift. `passed` and `completed` are defined once now.

**Three bugs found while building it, and all three produced plausible output:**

1. **`errored` did not exist before EVAL-14**, so it is NULL on older rows, and
   `errored = false` evaluates to NULL — silently dropping those rows from every
   rate. `aov-synonym` read 11 passed out of 26 runs at a pass_rate of 1.0. The
   `answered` dimension fixes it: a row that never says it errored, did not.
   **The old JS reporter had the same hole** — this is a bug the rewrite
   inherited and then exposed, not one it introduced.
2. **`flips` as a flat two-stage pipeline** compiles to `LAG(passed) OVER (ORDER
   BY sweep)` with NO PARTITION BY, so each case's "previous" value was whatever
   case sorted before it — `membership-verbatim` inherited `aov-synonym`'s.
   Because the numbers are mostly 3s it read as entirely reasonable. Calculating
   inside a nest keyed on the case produces the partition; reading the generated
   SQL was the only way to see it.
3. **A filename regex failed SILENTLY to an empty string** — the backslash
   escaping needed for a Windows path survives neither the Malloy string nor the
   SQL literal. `parse_filename()` has no escapes.

**Scope decision worth keeping:** the glob reads every stream — sweeps,
correlation, selftest, stripped-protocol — because that history is the most
interesting thing here. But a pass rate is only meaningful over the main sweep
stream (a stripped-protocol run is SUPPOSED to fail), so the rate views filter
to `stream = 'sweep'` and the descriptive ones do not. Verified by checking
`by_case` was byte-identical before and after widening the glob.

**And the first non-trivial question put to the model corrected this file** —
see "What live runs cost", which was wrong by 31%.

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

**RUN LIVE 2026-07-31 — evidence: `evals/results/selftest/`.** The mechanics
worked on the first try: both phases ran, both swaps restored, `CLAUDE.md`
byte-identical afterwards, no backup left behind, exit 1 with the right verdict.

**And it immediately earned its keep by failing.**

```
OK   no-rederivation-margin:          stripped=fail, real=pass — discriminates correctly
BAD  financial-situation-projection:  stripped=pass, real=pass — passed WITHOUT the protocol
```

`financial-situation-projection` carried `must_use` and nothing else. `must_use`
searches the whole trace INCLUDING tool results, and every URI it names appears
in `models/*.malloy` as a `# concept` annotation — so the ungoverned agent
compiled three models to inspect their schemas, the compile output echoed all
five URIs into the trace, and the check was satisfied by the model files rather
than by anything the agent decided. It passed with `receipt_present: false`,
having never read the Knowledge Plane.

**EVAL-7 in reverse, and general rather than a quirk.** EVAL-7 narrowed
`must_not_contain` because compile output echoed a FORBIDDEN pattern; this is
compile output supplying a REQUIRED one. And since SIMP-4 made "approved but
unbuilt" a hard build failure, *every* approved concept is annotated somewhere
in `models/` — so **at tier 2, `must_use` on its own is never evidence of
routing.** At tier 1 it still is: no tools, nothing to echo.

**Two fixes, one for the case and one for the class.** The case gained
`expect_receipt: true` — the check that made the other case fail correctly in
the same run, and one an ungoverned prompt has no reason to satisfy. EVAL-10's
load-time guard was tightened from "at least one cross-check" to "`must_not_contain`
or `expect_receipt`", because "at least one" was satisfiable by a check that
proves nothing. Four unit tests pin it.

**The fix was confirmed without spending anything.** Both runs already recorded
`receipt_present`, so re-grading the rows on disk under the amended case
settles it: SHIPPED had `true` and still passes, STRIPPED had `false` and now
fails. That is EVAL-12c's first lesson applied — the evidence had been paid for
already. It is a re-grade of recorded telemetry rather than a fresh run, so the
next live selftest is what confirms it end to end, but the inference is solid:
the stripped prompt never mentions receipts.

**One thing fixed on suspicion rather than evidence.** The control prompt
originally carried an HTML comment explaining the rules for editing it — which
named concepts, bindings, the routing table and receipts, i.e. exactly what the
control exists to withhold. The agent reads the file verbatim, comments
included. It demonstrably did NOT cause this failure (the stripped run's answer
never mentions `kp:` at all), but a control that names the things it controls
for is a contamination waiting to happen, so the rules moved to
`evals/protocols/README.md` — including the standing instruction that when the
selftest reports BAD, the fix belongs in the CASE and never in the control.
Weakening the control to make a case fail proves nothing.

**AUDITED ACROSS EVERY CASE, 2026-08-03 — evidence:
`evals/results/selftest/2026-08-03T*`.** `--all` was added (default stays the two
regressions, so the cheap gate is unchanged) and every case was run through both
phases: 12 runs, $6.30.

```
OK   financial-situation-projection  stripped=fail, real=pass   <- yesterday's fix, confirmed LIVE
OK   membership-verbatim             stripped=fail, real=pass   <- previously unaudited
OK   no-rederivation-margin          stripped=fail, real=pass
OK   refusal-ungoverned              stripped=fail, real=pass   <- previously unaudited
BAD  aov-synonym                     stripped=PASS, real=pass   <- second hollow case
INFO refusal-routing-decision        exempt (see below)
```

Two of the four tier-2 cases had never been audited and both discriminate — and
via three different mechanisms, which is healthy: `expect_receipt` (2 cases), a
`query_shape` mismatch (`membership-verbatim` — the ungoverned agent got the
membership rule wrong), and the `refusal` kind (`refusal-ungoverned` computed a
number instead of declining).

**It also confirmed yesterday's fix live**, which had only been established by
re-grading rows on disk. `financial-situation-projection` now fails the stripped
phase.

**And it found a second hollow case, `aov-synonym`.** The cause is different
from the first and specific to tier 1: the harness INJECTS the routing table
into the tier-1 prompt, so "resolve AOV to `kp:AverageOrderValue` and query its
binding" is answerable from the table the harness handed over, protocol or no
protocol. `must_use`, `must_not_contain` and the gold query shape were all
satisfied that way.

**A claim written earlier the same day, and corrected by the measurement.** The
first draft of this said the tier-1 prompt "IS most of the protocol", so tier-1
cases were made structurally ungradeable. The data says otherwise: `aov-synonym`
recorded `receipt_present: true` under the real protocol and `false` under the
stripped one, on the same question. CLAUDE.md still does work at tier 1 — that
case simply was not asserting the part that depends on it. Adding
`expect_receipt: true` makes it discriminate, and re-grading the recorded rows
confirms it: SHIPPED still passes, STRIPPED now fails.

**So the exemption is one case, by name, with its reason** — not a blanket
tier-1 rule that would silently exempt every future tier-1 case too.
`refusal-routing-decision` is beyond this test because its ENTIRE right answer
is "CLV is absent from the routing table", and the harness injects that table;
it also returns no figure, so there is no receipt to assert. The exemption
prints on every run, and a stale entry naming a case that no longer exists is a
hard error.

**Where that leaves the suite:** 5 of 6 cases are now demonstrated to test the
protocol, 1 is documented as untestable by this method, and 0 are unaudited.

**The general lesson, and it is not about tier 1.** Both hollow cases were
satisfied by something the HARNESS or the REPO supplied — compile output
carrying `# concept` annotations in one, the injected routing table in the
other. Neither could have been caught by reading the case: they look like
thorough assertions. What separates a case that tests the protocol from one that
does not is whether some part of its assertion set depends on a rule that lives
ONLY in CLAUDE.md. Today the receipt is the reliable such lever, which is an
argument for `expect_receipt: true` on any case that returns a figure.

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

**Status: DONE (format-only scope), 2026-08-06.** `SPEC.md` (OKF v0.2) landed
in the repo at `299885f`; OKF-1 through OKF-5 shipped in the same pass on
branch `okf-2.0`.

**Scope decision made at the start of this pass, not re-litigated per file:**
adopt the v0.2 provenance/trust/lifecycle families (`generated`, `verified`,
`status: draft|stable|deprecated`) and move the governance gate from
`status: approved` onto `status: stable` + a human `verified` entry. Do NOT
build §10 Attested Computation (real executor/attester attestation for
measures) in this pass — that is real, separate design work (a Malloy
executor/attester pair, eval-grading changes) and is queued as its own
future phase below, not mixed into a format migration.

### OKF-1 · Pin the version we claim to conform to · 0.5 day · DONE

`kp/bundle.yaml` gained `okf_version: "0.2"`; `okf-lib.js` asserts it on load
and stamps it as frontmatter on the generated root `index.md` (SPEC.md §12 —
the only place frontmatter is permitted in an `index.md`).

### OKF-2 · Read the new spec and diff it against the bundle · DONE

Delta table produced before any file was touched (as instructed). Straightforward,
no-decision items: `# Citations` → `sources` (moot, none exist yet); `uri:`,
`relationships:`, `of:`, `subtype_of:`, `preferred_source:`, `allowed_roles:`,
`synonyms:`, `steward:` all kept as producer extensions (SPEC.md §4.1 permits
arbitrary extension keys; the spec's own concept-ID-by-path and prose-only
relationships would have thrown away path-independent identity and the
validated conceptual graph for no conformance gain). Real forks, resolved by
the operator before OKF-3 ran: (1) format-only vs. also building Attested
Computation this pass → format-only; (2) `status: approved` kept as our own
value vs. renamed to `stable` with the gate moved to `verified` → renamed,
gate moved; (3) how to backfill `generated.by` given no prior per-file
authorship record → `human:<steward>`, `human:global` where there is no
steward. Verified before backfilling: `approved_by` equalled `steward` on
every one of the 34 files that carried it (0 mismatches) — the same actor
derivation was safe to apply to all 55 concepts, not just the ones with an
explicit `approved_by`.

### OKF-3 · Migrate the bundle · DONE

`migrate-okf-02.js` (repo root, re-runnable, idempotent — skips a file that
already has `generated:`): `timestamp` → `generated: { by, at }`; on a concept
that was `approved`, adds `verified: { by, at }` (same actor/date — see OKF-2),
removes `approved_by`, renames `status: approved` → `stable`, drops the
redundant `approved` echo from `tags:`. All 55 concepts + 4 templates + the
`CLAUDE.md` GOV-1 profile migrated; `kp/agent/*.md` operational docs and eval
case files needed no changes (minimal frontmatter, no status/timestamp
fields). Relationships kept as-is (extension, not a spec concern — see OKF-2).

### OKF-4 · Update the writers and validators · DONE

`okf-lib.js`: loader now parses `generated`/`verified`, computes a trust tier
(SPEC.md §5.3) and a `governed` boolean (`status: stable` AND a `human:`
`verified` entry — the two lifecycle/trust axes collapsed into the one thing
the agent and the build actually need); root routing table gained a Verified
column. `build.js`: both hardcoded `status !== 'approved'` gates now read
`governed`. `CLAUDE.md`, `ARCHITECTURE.md`, `docs/steward-onboarding.md`,
`README.md` updated to the new vocabulary and gate. `excel_to_okf.py` /
`okf_to_excel.py`: `STATUS_MAP`/`STATUS_OUT` retarget `approved`→`stable`,
`In review` retired (no v0.2 equivalent — falls back to `draft` with a
warning, was previously silently accepted); both directions now round-trip
`generated`/`verified` instead of `approved_by`/`timestamp`. `make_viz.py`
needed no change (doesn't key off these fields).

### OKF-5 · Re-validate, and prove nothing moved · DONE

`npm test` (89/89, one self-protective skip mid-edit) → `npm run build` (clean
tree, 0 concept files touched by write-back) → `npm run eval:check` (7/7 tier-0
checks, gold current) all green. Live half: a full before/after sweep was not
run (cost/scope call — see the conversation that shipped this); instead, the
cheap tier-1 probe ran post-migration against the working `CLAUDE.md` + `kp/`:
`refusal-routing-decision` (the case that specifically exercises the reworded
governance-gate language and the new Verified column) passed 3/3 clean, 0
Malloy calls. `aov-synonym` scored 5/6 across two runs; the one miss was a
tier-1 repair-turn narration artifact (the executed query and result were
exact-match correct — the agent's blind repair-turn text just didn't restate
the receipt) unrelated to anything this migration touched, confirmed by a
clean solo rerun. No verdict flipped from what the format previously produced.

**Deferred, not forgotten:** §10 Attested Computation for measures (real
executor/attester attestation, replacing the honor-system binding table) is
real design work, queued as its own future phase — see the scope decision
above. `kp/agent/evals/*.md` and `evals/lib/*.js` still say "approved" in a
few historical narrative comments (SIMP-4/SIMP-5 write-ups) — left as-is
deliberately, since those describe what was true when they were written, not
the current vocabulary.

### Review follow-ups (post-merge code review, 2026-08-07) · OKF-6/7/8 DONE, OKF-9 already-closed, OKF-10 logged (branch `okf-review-followups`)

Findings from reviewing the shipped OKF v0.2 migration (`f5064e1`) as code, not
as a spec adoption. The migration is sound and `migrate-okf-02.js` is exemplary
(idempotent, `--dry-run`, CRLF-aware, formatting-preserving). All four original
findings are resolved (OKF-9 turned out to be already-guarded); a fifth
(OKF-10) surfaced while proving OKF-7/8 and is logged below.

| Code | Item | Severity | Status |
|---|---|---|---|
| OKF-6 | Governance predicate is untested | **high** | **DONE** (`6af67ef`) — extracted the inline `governed` boolean to `governedOf(status, verified)` and pinned `verifiedList`/`trustTierOf`/`governedOf` with a table test. |
| OKF-7 | Python round-trip scrapes a hand-serialized string with regex | **medium** | **DONE** (`4a397c9`) — `okf_to_excel.py` now parses frontmatter with `yaml.safe_load`; `flow_field`/`frontmatter`/`unq`/`unlist`/`import re` all gone. |
| OKF-8 | Duplicated helpers across the polyglot boundary | low | **DONE** (`a444458`) — one `slugify` per language (`okf-slug.js`, `okf_slug.py`), pinned by a cross-language golden test. |
| OKF-9 | Lossy status mapping is unguarded | low | **ALREADY CLOSED** — the warn guard the finding asked for already exists at `excel_to_okf.py:61` (`if st not in STATUS_MAP: warnings.append(...)`), added `b838adc` (2026-07-24), before this review. The review missed the existing line. No code change; no test (the whole `excel_to_okf.py` validation path is untested — a future item if the Excel surface is revived, see OPT-6). |
| OKF-10 | Excel round-trip is NOT byte-identical to `kp/` (CRLF + field reorder) | low | **DONE** (`56be7c3`) — Python writers now emit LF; round-trip byte-identical; `kp_viz.html` no longer churns to CRLF. See below. |

#### OKF-6 · Unit-test `trustTierOf` / `governed` · DONE (`6af67ef`)

Extracted the inline governance boolean at `okf-lib.js:97` into
`governedOf(status, verified)` (behaviour-preserving: build stays clean, routing
table byte-identical) and exported it. Table test pins: `verified` absent →
`unverified`; only non-`human:` actors → `machine-confirmed`; any `human:` actor
→ `human-reviewed` (incl. the `human:` **prefix** not being fooled by a
substring like `not-a-human:x`); `governed` true **only** when `status: stable`
AND tier `human-reviewed` (so `stable` + machine-only is NOT governed, and
`human-reviewed` + `draft` is NOT); and `verifiedList` normalizing a bare
`{ by, at }` mapping to a one-element list (SPEC.md §5.2). The EVAL-8 lesson:
logic that gates the build and the agent is pinned by a test, not observed live.

#### OKF-7 · Replace the Python regex frontmatter parse with real YAML · DONE (`4a397c9`)

`okf_to_excel.py` now parses the frontmatter block with `yaml.safe_load`, so
`verified`/`generated` come back as real dicts and `relationships` as a list of
dicts; `flow_field`, `unq`, `unlist`, the `__nested` line handling, and the last
`bundle.yaml` namespace regex all go away (and with them `import re`). Gate met
**without touching `kp/`**: the workbook is a pure function of the parsed values,
so old-vs-new `okf_to_excel.py` over the real bundle producing a byte-identical
workbook (0 cell diffs across all 4 sheets, 55 concepts / 6 relationships) proves
the round-trip is unaffected. The change is also a real fix, not just a rewrite:
a SPEC.md §5.2 list-form `verified` (machine build + human sign-off) that the old
line-matcher silently dropped to an empty `Approved on` now reads the first
entry's date. Full `okf_to_excel → excel_to_okf` round-trip against a scratch
copy confirmed byte-identical to `main`'s scripts.

#### OKF-8 · One shared slugify per language, pinned by a golden · DONE (`a444458`)

`slugify` mints the `human:<steward>` actor in `generated`/`verified`, and it
lived twice in JS and Python with nothing checking the copies agree. Extracted
each language's copy into one importable, side-effect-free module (`okf-slug.js`
used by `migrate-okf-02.js`; `okf_slug.py` used by `excel_to_okf.py`) and pinned
the contract with one golden table in `unit.test.js`: a JS test asserts the JS
slug matches the golden, and a second shells out to the REAL `okf_slug.py` and
asserts byte-identical output (skips cleanly when no python is on PATH, mirroring
`build.js`'s viz probe). `KINDS` and the `GEN_BEGIN/END` markers remain
duplicated across the language boundary — that is inherent to a two-language repo
and the build-clean invariant catches marker drift; only `slugify` (the subtle,
actor-minting one) warranted the shared module + test.

#### OKF-10 · The Excel round-trip is not byte-identical to `kp/` · DONE (`56be7c3`)

Surfaced while proving OKF-7/OKF-8, and the concrete face of the recurring
CRLF/LF churn. **Diagnosis (corrected from the first pass):** the repo policy is
already right — `.gitattributes` `* text=auto eol=lf` forces LF everywhere and
overrides a contributor's `core.autocrlf`; committed blobs are all LF (0
`i/crlf` files repo-wide); `kp/` is genuinely LF (not CRLF — the first write-up
misread a `grep -c $'\r'`). The real root cause is that **Python's text-mode
`open('w')` defaults to `os.linesep` (CRLF on Windows)**, so every Python writer
emitted CRLF and fought the policy. Git hid it (normalized-clean), but every
byte-level tool (`diff`, round-trip byte-identity) saw it.

Two-part cause, two fixes:
1. `excel_to_okf.py` wrote CRLF **and** emitted `last_validated` before
   `generated`/`verified` (authored files put it after). Fix: `newline='\n'` on
   both writes + move `last_validated` after provenance. The full
   `okf_to_excel → excel_to_okf` round-trip against a scratch copy of `kp/` is
   now **byte-identical (exact diff, no CR stripping)** — so ARCHITECTURE.md's
   "verified byte-identical" claim is finally true, no doc edit needed.
2. `make_viz.py`'s vendored `generate_visualization` writes CRLF, leaving
   `kp_viz.html` as `w/crlf` after every build. Fix: normalize the output HTML
   to LF after it returns. Verified: two consecutive builds are byte-stable and
   leave the tracked html clean.

**General policy going forward:** any Python file-writer that targets the tree
must pass `newline='\n'` (Node writers are already fine — they join on `'\n'`
and don't translate). Only these two Python writers exist today; both fixed.

---

## Planned & triggered — detailed design notes

*The item tables and their triggers live in [ROADMAP.md](ROADMAP.md) (Phases 3,
3b, 4). The detailed design reasoning for the triggered items follows.*

### HIER-1 — Dimensional hierarchies and measure roll-up (triggered)

Trigger: a domain where either a measure is semi-additive (see below), or a hierarchy has contested level names, ordering not implied by the Malloy joins, or multiple valid ladders over the same leaves (e.g. a store rolling up to both a sales region and a legal entity). A clean single-ladder hierarchy with obvious names and one join-implied order is already handled by joins plus a rollup measure and needs no new object. Not warranted by Contoso, whose geography ladder is three levels Malloy traverses by join path.

First, the correction that shrinks this item: additivity is mostly a Malloy property, not a KP field. Malloy defines a measure once at the base grain as an aggregate expression and recomputes it from leaf rows at every grouping level — it never rolls up pre-aggregated values. A plain additive measure (NetPrice.sum()) is correct at every level with no annotation, and a ratio (margin %, occupancy %) is also correct automatically, because at each level it recomputes numerator-over-denominator from that level's rows rather than averaging the level below. The classic sum(occupancy rates) disaster is a stored-aggregate problem Malloy structurally does not have. Do not add a broad rollup: additive/non_additive field — it annotates what the engine already infers.

What the KP must carry is the three things Malloy cannot infer from the expression:

Semi-additive measures — balances, inventory-on-hand, headcount: additive across space, but with a specific temporal rule. Malloy has no LASTNONBLANK equivalent; a naive balance.sum() silently double-counts across time at every level above the leaf, and the engine will not catch it because you told it to sum. Declare the rule explicitly so the agent routes deterministically instead of inferring it from an example: rollup: semi_additive carrying the time dimension and one of last_value | first_value | average | period_end | none. (none = no valid temporal aggregation exists; only ever show at a point in time — distinct from period_end, and the enum value where the next silent-wrong-answer would otherwise hide.) Pair the flag with a blessed two-stage pattern in examples.md (pick each entity's state per the rule within the period, then aggregate across space), because the correct form is a query structure, not a droppable measure.
Weighting choices — where a rollup is a weighted average, which weight is correct (by area, by unit count, by lease value) is a business decision Malloy cannot derive. Record the decision in the plane; the implementation is then an ordinary Malloy measure that recomputes correctly at every level.
do_not_aggregate — measures meaningful only at a specific grain (a rank, a period-end snapshot, a non-summable distinct count). Malloy will happily compute them at any grain; whether that is meaningful is governed judgment.

Contoso test: if any measure is a balance/inventory/headcount figure it is the ideal semi-additive prototype; if not, semi-additivity stays a real-estate-era concern and only the hierarchy object below is exercised.

The hierarchy object remains a bet to validate before building. A new type: hierarchy concept file lists the ordered levels and, per level, the governed dimension that realises it (realised_by: kp:StoreCountry). It carries only the sliver Malloy structurally cannot: the ordering of the rungs, their contested business names ("is Kraków a Market or a Submarket?"), and the existence of more than one valid ladder over the same leaves. It must not re-declare containment — which store is in which country stays in the Malloy joins; duplicating it is the join-map mistake in another costume. Note the boundary precisely: contested or multi-ladder structure is KP meaning; skip-level / variable-depth structure (some units under a Building, others directly under Property) is a data-shape problem Malloy's join paths already handle and is not a reason to reach for this object — that is the DuckGQL note's territory. A new type is not a small change: it touches okf-lib parsing, a new node kind in the graph/viewer, the routing table, and validation that each level's realised_by resolves to a real dimension. Prototype the schema cheaply against Contoso geography (Store→Country→Continent) to get levels, realised_by, and the level-resolution check right; then hold the full build until a qualifying hierarchy makes it load-bearing.

Naming-as-identity — decide this week, independent of the trigger. If a measure means genuinely different things at different grains, those are distinct URIs, not one URI at two grains — and the convention is cheap now, expensive to retrofit after people have written a bare kp:Occupancy for a year. Use a fast structural pre-filter, then a definitive tiebreaker:

Pre-filter: different numerator/denominator structure → likely distinct URIs; same quantity recomputed at different grain → likely one URI. (Exclude currency and unit-of-presentation: revenue in USD vs EUR is one concept with a given/parameter, not two URIs.)
Tiebreaker when the pre-filter is ambiguous: could a single Malloy measure, defined once at the leaf grain, recompute this correctly at every level? If yes → one URI. If the definition itself changes with level — a different filter, a different weighting, or a different question being asked (unit occupancy "is this let?" vs portfolio occupancy "area-weighted %") → distinct URIs. This decides on the thing that actually matters — one computation or several — rather than on surface features that can mislead.

The common case — one measure rolled up a hierarchy (NOI at six levels) — stays a single concept. Write the convention down before the first hierarchical measure is authored.

Note on tooling (do not act): a graph-query engine over the containment structure (e.g. DuckGQL's variable-length MATCH) is a data-plane option for deep, ragged (variable-depth) hierarchies if Malloy's join-path traversal ever becomes a measured performance problem — not a knowledge-plane tool, and not a substitute for the ordered-level meaning above. File in memory; no roadmap action until real hierarchical data shows Malloy struggling with depth.

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

### A cross-check the SYSTEM can satisfy on the agent's behalf checks nothing

From SIMP-5's first live selftest. `must_use` searches the whole trace including
tool results — deliberately, since reaching for a concept should count however
it shows up. But the models carry `# concept` annotations, and the build forces
every approved concept to have one, so **compiling a model hands the agent every
URI the check is looking for**. An `analysis` case whose only cross-check was
`must_use` therefore passed against a deliberately ungoverned protocol, with no
receipt and no visit to the Knowledge Plane, and had presumably been doing so
since the day it was written.

This is the third variant of one question: *who actually produced the evidence
this check is reading?* EVAL-7 — compile output supplying a FORBIDDEN pattern,
failing a correct agent. Here — compile output supplying a REQUIRED one, passing
an incorrect one. **When adding an assertion, ask what else in the repo could
satisfy it besides the behaviour under test.**

**Fourth variant, found two days later by the same tool.** `aov-synonym` was
hollow for a different supplier: the HARNESS injects the routing table into the
tier-1 prompt, so its routing assertions were answerable from the prompt itself.
Compile output, injected context — the pattern generalises past any one source.
The practical test that survives all four: **does some part of this case's
assertion set depend on a rule that lives ONLY in `CLAUDE.md`?** Today the AGT-1
receipt is the reliable such lever, which is a good argument for
`expect_receipt: true` on any case that returns a figure.

And the reason both were caught at all: the selftest is the only mechanism here
that asks the question empirically. **A case is not coverage until it has been
audited** — reading it cannot tell you, because a hollow case looks exactly like
a thorough one.

And the corollary about guards: EVAL-10 already required "at least one
cross-check" on `analysis` cases, and that guard was GREEN on this case
throughout. A rule that counts cross-checks cannot tell whether any of them
discriminates.

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

### An aggregate that looks reasonable is not a checked aggregate

From SIMP-2, four times in one item. A pass_rate of 1.0 over 26 runs, a flip
count of 3, a sweep name, and a "spent so far" total — every one of them wrong,
none of them implausible enough to question. Aggregates are the worst place in
this repo for a bug to live, because the output is a small number that carries
no evidence of how it was computed, and the reader's only check is whether it
feels about right.

Two habits follow. **Read the generated SQL when a window function or a NULL is
anywhere near the answer** — the PARTITION BY bug and the NULL-drop bug were
both invisible in the Malloy and obvious in the SQL. And **never maintain a
figure by hand across commits when the rows to compute it are on disk**: the
$25.55 tally was incremented a dozen times, missed whole streams, and nothing
was checking it. Cite the query, not the total.

