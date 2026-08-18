# Roadmap — Knowledge Plane + Malloy models

**How to read this.** Work is tracked by stable codes (`EVAL-8`, `SIMP-1`, …)
that code comments and commit messages cite, so codes never get reused or
renamed. This file is the dashboard: current status, the gates, and the list of
items. **The full write-up for every item — the reasoning, the evidence, the
follow-ups — lives in [LEARNINGS.md](LEARNINGS.md)** under the same code, along
with the "Decided — do not relitigate" record and the cross-cutting lessons.
Finished items keep their full detail on purpose; it is cited constantly by
later work.

**Jump to:** [Status](#status--where-we-are) ·
[Gates](#gates-and-how-to-run-them) ·
[What live runs cost](#what-live-runs-cost) ·
[Completed items](#completed--item-index) ·
[Planned & triggered](#planned--triggered-work) ·
[LEARNINGS.md](LEARNINGS.md)

---

## Status — where we are

**Branch `eval-12-tiering`, 2026-08-03.** Tree clean, all gates green at every
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
| `3f5487c` | SIMP-5 (`--protocol` is a runner flag) + the test that was lying |
| `35e16fd` | The selftest run that found a case testing nothing |
| `506b32e` | The selftest audit over every case, which found a second one |
| `1715961` | EVAL-5: the harvest sources are empty, and that is the finding |
| `9a37911` | SIMP-2 (`evals/results.malloy`), which closes Phase 2c's opportunistic half |

**EVAL-12 is closed.** All four levers plus the invariant have shipped.

**Phase 2c is closed except for its two trigger-gated items** — SIMP-1's
deletion (waiting on more tier-1 cases) and SIMP-6 (waiting on case authoring
becoming the bottleneck). SIMP-2, 3, 4 and 5 have all shipped.

### Picked up next, in order

1. **EVAL-18 DONE and CONFIRMED (2026-08-07)** — harness-wide fix: all 16 case
   files moved `kp/agent/evals/*.md` → `evals/cases/*.md`, outside the `kp/`
   tree the agent explores. Re-audit confirmed the 3 formerly-blocked cases now
   discriminate (relocation alone sufficient, no hiding needed). Committed
   `71f03e2` on `eval-5-harvest`. See EVAL-18's section.
2. **`bike-name-match-contamination` RESOLVED (2026-08-07)** — it was a grading
   fragility, not a product error (the agent's answer was always correct). Fixed
   in three layers: revenue-robust gold, EVAL-19 (grader descends into nests),
   and dropping the redundant `must_not_contain`. Discriminates across 4 live
   runs (real pass ×2 / stripped fail ×2). EVAL-19 shipped and unit-tested. See
   EVAL-18's bike-name entry and EVAL-19.
3. **EVAL-5 CLOSED (2026-08-07)** — the initial-backlog harvest is done (9 cases,
   8 discriminating + 1 exempt) and the three source logs are drained. The ~30
   was a volume aspiration tied to question throughput, never a completion bar;
   with no new questions arriving there is no material to harvest, so the task is
   closed and re-opens implicitly via the standing pipeline rule below. Backlog
   (deferred, not lost): a Home Appliances discount/margin case + control variant
   were sketched but not authored — pick them up if that question recurs.
4. **Post-merge review follow-ups DONE (2026-08-07, branch `okf-review-followups`)**
   — OKF-6 (`6af67ef`, governance predicate now unit-tested), OKF-7 (`4a397c9`,
   real YAML in `okf_to_excel.py`), OKF-8 (`a444458`, one shared slugify per
   language + cross-language golden test) all shipped and green (115 tests).
   OKF-9 was already closed (the warn guard exists). OKF-10 (`56be7c3`) also
   done: fixed the recurring CRLF/LF churn at its root — Python writers now emit
   LF (`newline='\n'`), the Excel round-trip is byte-identical to `kp/`, and
   `kp_viz.html` no longer churns to CRLF on build. See Phase 2d's "Review
   follow-ups". Branch not yet merged.

**Then:** pick a server — INT-1/INT-2 first (both runtime-independent), then
INT-3a or INT-3b with INT-6.

**Continuously (the standing pipeline — outlives EVAL-5's closure):** every
correction filed gets an eval case in the same PR. This is what re-opens
harvesting when new questions arrive; the ~30 target is retired as a goal.

**Phase 2d is DONE (2026-08-06, branch `okf-2.0`)** — format-only OKF v0.2
adoption. See its section for the full record; §10 Attested Computation is
deferred to its own future phase, not folded into this one.

**On trigger only:** what is left of Phase 2c (SIMP-1's deletion when most cases
are tier 1, SIMP-6 when authoring cases becomes the bottleneck), Phase 3b and
Phase 4.

### Gates, and how to run them

`npm test` (89 cases, ~2s — one of them spawns the real CLI) → `npm run build`
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
- `npm run eval:report -- --view <name>` — any view in `evals/results.malloy`
  (SIMP-2), not just the three the reporter prints by default. Ask the history a
  question here rather than writing a throwaway script.

There was NO tracked unit test before `352224d`: `porcelainPaths` was exported to
be testable and its tests were never committed, which is the EVAL-8 lesson twice
over. `npm test` is now wired into the build gate ahead of `build.js`.

### What live runs cost

**Spent so far: $36.94** — measured, not tallied:

```
npm run eval:report -- --view sweeps      # sums cost_usd over every recorded run
  sweep        51 runs   $22.32
  selftest      9 runs    $5.86
  correlation  24 runs    $4.43
  protocol      9 runs    $4.35
```

**This line used to read ~$25.55, and it was wrong by 31%** — the first
non-trivial question put to `evals/results.malloy` (SIMP-2) corrected it. The
hand-maintained tally counted the runs someone remembered to add up and missed
whole streams; the model sums the rows. A figure maintained by hand across a
dozen commits drifts, and nothing was checking it. Re-read it from the model
rather than incrementing it.

A 2-case x 3-run correlation is ~$2.50 for both lanes together.

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
cannot fail). AGT-3 → DONE. EVAL-11 → DONE, by case conversion. EVAL-13 → 3 of
3; the third was folded into SIMP-2 and closed with it, by deleting the file
that held the bug. **Phase 2b is CLOSED** — EVAL-12b was the last item in it.

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

## Completed — item index

Full write-ups (reasoning, evidence, follow-ups) for every code below live in
**[LEARNINGS.md](LEARNINGS.md)**. Codes are stable and are cited by commits and
code comments; the index here is the roll-call, the detail is in LEARNINGS.

### Phase 1 — Foundations · DONE
| Code | Item | Status |
|---|---|---|
| GOV-1 | Governance profile (frontmatter) for CLAUDE.md | DONE |
| GOV-2 | Global/local concept tiers + promotion path | DONE |
| AGT-1 | Provenance footer (answer receipt) | DONE |
| AGT-2 | "Don't bail early" rebuttals in CLAUDE.md | DONE |
| OPS-1 | CI workflow (build gate on every PR/push) | DONE |
| OPS-2 | Steward onboarding + README refresh | DONE |

### Phase 2 — The eval runner · DONE
| Code | Item | Status |
|---|---|---|
| EVAL-1 | Eval runner (headless, N=3 quorum, multi-kind grading) | DONE |
| EVAL-2 | Anchored ground truth (gold_query vs agent query) | DONE |
| EVAL-3 | Results as telemetry (JSONL rows) | DONE |
| EVAL-4 | Fixture data for CI (committed parquets) | DONE |
| EVAL-5 | Seed from real usage (9 cases harvested) | CLOSED 2026-08-07 |
| EVAL-6 | Semantic identity hash | DONE |
| EVAL-15 | Selftest `--protocol` backup-file leak | DONE |
| EVAL-16 | Stripped control didn't hide operational docs | DONE |
| EVAL-17 | Receipt detection (markdown + cross-turn) | DONE |
| EVAL-18 | Case files moved out of `kp/` (answer-key leak) | DONE 2026-08-07 |
| EVAL-19 | `query_shape` descends into nested results | DONE 2026-08-07 |
| — | Also shipped: `eval:gold`/`eval:check`, `eval:selftest`, committed-vs-explored grading | DONE |

### Phase 2b — Fixes from the first sweep review · DONE
| Code | Item | Status |
|---|---|---|
| EVAL-7 | `must_not_contain` scope (false positive) | DONE |
| EVAL-8 | `last_validated` stamping poisoned identity | DONE |
| EVAL-9 | `subset` verdict unsound (row + column) | DONE |
| EVAL-10 | `analysis` cases can be vacuous | DONE |
| AGT-3 | Cheap refusal (protocol fix from telemetry) | DONE |
| EVAL-11 | Numeric extraction fragility | DONE |
| EVAL-12 | Make suite cheap enough per PR (four levers) | DONE |
| EVAL-12a | Tier 1, the cheap lane | DONE |
| EVAL-12b | Impact selection + concurrency | DONE |
| EVAL-12c | Prompt caching across runs | DONE |
| EVAL-12d | The correlation check | DONE |
| EVAL-14 | Transport failures are not verdicts | DONE |
| EVAL-13 | Minor harness fixes | DONE |

### Phase 2c — Simplification
| Code | Item | Status |
|---|---|---|
| SIMP-1 | Decision-grading deletes the trajectory layer | SHIPPED as a lane; deletion trigger-gated |
| SIMP-2 | Report in Malloy, not JavaScript | DONE |
| SIMP-3 | One shared Malloy lib | DONE |
| SIMP-4 | Tier-0 checks fold into `build.js` | DONE |
| SIMP-5 | `selftest` becomes a flag, not a file | DONE |
| SIMP-6 | Snapshot + diff instead of authored assertions | OPEN (trigger-gated) |

### Phase 2d — OKF spec upgrade · DONE
| Code | Item | Status |
|---|---|---|
| OKF-1 | Pin the OKF version | DONE |
| OKF-2 | Read spec, diff against bundle | DONE |
| OKF-3 | Migrate the bundle | DONE |
| OKF-4 | Update writers and validators | DONE |
| OKF-5 | Re-validate, prove nothing moved | DONE |
| OKF-6 | Unit-test the governance predicate | DONE |
| OKF-7 | Python round-trip uses real YAML | DONE |
| OKF-8 | One shared slugify per language | DONE |
| OKF-9 | Lossy status-mapping guard | ALREADY CLOSED |
| OKF-10 | Excel round-trip byte-identical (CRLF/LF) | DONE |

---

## Planned & triggered work

*Forward-looking items. Detailed design notes for the triggered items are in [LEARNINGS.md](LEARNINGS.md).*

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
| HIER-1 | New structure in knowledge plane to handle hierarchies + aggregation logic for some measures.
| OPT-1 | Adversarial review step — a reviewer sub-agent challenges final answers (Anthropic: +6% accuracy, +32% tokens, +72% latency) | evals plateau below target |
| OPT-2 | Standalone visualizer — self-contained `make_viz`, no knowledge-catalog clone; can style declared vs derived edges, statuses | graph becomes a regular business-review artifact |
| OPT-3 | Hierarchical bundle walk replaces read-whole routing table | routing table outgrows a single read (~hundreds of concepts) |
| OPT-4 | Coverage-warning tuning — flag only derived fields, not raw columns | already identified; fold into next `build.js` touch |
| OPT-6 | Excel authoring surface — REVIVED (v10) | Real steward pushback on editing markdown. `excel_to_okf.py` (archived, v5/v6) still works and preserves write-backs. **Hard rule if revived:** Excel becomes the SOLE write path for the frontmatter fields it owns — no mixed hand-editing, or the two paths silently fight. (0.5 day) |

**Detailed design notes** for the triggered items — HIER-1 (dimensional
hierarchies and measure roll-up), OPT-5 (change classification + impact
detection), GOV-3 (RLAC via inline givens), and GOV-4 (per-user context
personalization) — live in
**[LEARNINGS.md](LEARNINGS.md#planned--triggered--detailed-design-notes)**.
