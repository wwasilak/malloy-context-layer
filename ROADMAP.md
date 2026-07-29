
## Phase 1 — Now (hours, no dependencies)

| Code | Item | Detail | Effort |
|---|---|---|---|
| GOV-1 | Profile for CLAUDE.md — DONE | Frontmatter added to CLAUDE.md: owner, status, approved_by, timestamp (owner/approved_by = Knowledge Plane). The most powerful context file must not be the least governed. | done |
| GOV-2 | Global/local tiers — DONE | `global/` folder (renamed from core) = company-wide definitions; domain folders = local. Promotion path: shared-concepts report flags candidates → reviewed PR moves the file. Same label, different meanings = distinct URIs; ambiguous labels resolve to global. One definition per URI stands. | done |
| AGT-1 | Provenance footer — DONE | CLAUDE.md "Answer receipt" section: every answer ends with basis (governed measure / exploratory), data freshness (max date used), concept steward. Main mitigation for silent wrong answers; the "answer receipt". | done |
| AGT-2 | "Don't bail early" rebuttals — DONE | CLAUDE.md pre-rebuttal block in the Analysis-freedom section: the excuses for abandoning governed measures ("needs a custom date window", "needs a join", "needs a ratio" — none justify raw-column improvisation). | done |
| OPS-1 | CI workflow — DONE | `.github/workflows/build.yml`: runs `npm run build` on every PR + pushes to main; fails on validation errors; fails if the working tree is dirty after build (forces committed write-back). Turns every guarantee in this repo from convention into gate. | done |
| OPS-2 | Steward onboarding + README refresh — DONE | `docs/steward-onboarding.md`: how to add/edit a concept (template, frontmatter, PR, what each build error means). README rewritten for the OKF-bundle reality (MOTLY/knowledge_map.json era removed). | done |

## Phase 2 — the load-bearing build: eval runner — DONE

Shipped as `evals/` + `.github/workflows/eval.yml`. See `docs/evals.md` and
`PHASE2_SPEC.md`. `npm run eval` produces a scored, timestamped,
provenance-stamped results file; `npm run eval:report` diffs the last two runs.

| Code | Item | Detail | Status |
|---|---|---|---|
| EVAL-1 | Eval runner — DONE | `evals/run.js` loops `kp/agent/evals/*.md` through headless Claude Code (prompt over stdin), grades numeric/refusal/contains/query_shape/analysis, runs each case N=3 with a quorum, exits non-zero on failure. Cross-checks (`must_use`, `must_not_contain`, `expect_receipt`) run for every kind and are what catch the real failures. | done |
| EVAL-2 | Anchored ground truth — DONE | `query_shape` grading runs the agent's Malloy AND the `gold_query` against the same data and compares result sets (order-insensitive; `exact` / `values` / `subset` recorded). Gold numbers are pinned to committed fixtures. `membership-verbatim` converted to method grading — its bound measure anchors to `LOCALTIMESTAMP`, so a pinned number would rot on a calendar boundary. | done |
| EVAL-3 | Results as telemetry — DONE | One JSONL row per (case × run) in `evals/results/`, plus a `run_meta` header line. Records verdict + reason, answer excerpt, executed Malloy, extracted vs expected, tokens, cost, latency, turns, receipt presence, semantic identity, model, runtime, data source. `evals/report.js` prints per-category pass rate, pass→fail flips and flaky cases. `last_validated` stamping on passing `must_use` concepts — the writer `ARCHITECTURE.md` documented but nothing implemented. | done |
| EVAL-4 | Fixture data for CI — DONE (no new files) | The parquets under `ParquetFiles/` are already committed, so CI checks out byte-identical data and gold values are already stable. A second sampled copy would add a sync burden and a fixture-vs-live gold discrepancy for no gain, so `fixtures` means the committed set resolved via WORKDIR (as `build.js` does) and `--live` switches to `EVAL_LIVE_WORKDIR`. | done |
| EVAL-6 | Semantic identity hash — DONE | `sha256(digest(kp/) + digest(models/) + digest(CLAUDE.md) + malloy/duckdb/dialect)` on every result row; `eval:report` uses it to say whether a flip means the data moved or the meaning moved. Digests the WORKING TREE (evals matter most on uncommitted edits); git tree shas recorded alongside with a dirty flag. `CLAUDE.md` is included because the routing protocol can move every number without touching a concept. | done |
| EVAL-5 | Seed from real usage | Both known regressions run and are covered by the selftest. Harvesting from question-log/corrections continues; target ~30 cases, refusal + tier-boundary over-represented. | ongoing |

Also shipped, not in the original spec:

| Item | Detail |
|---|---|
| `eval:gold` / `eval:check` | Gold values are computed from `gold_query` and written into the case, never typed. `eval:check` is the read-only CI form — verifies every case parses, every gold query still runs, and no committed value drifted, with no agent involved, so it can gate today. It immediately found two cases whose gold queries had never been executable. |
| `eval:selftest` | The regressions must FAIL against a deliberately stripped `CLAUDE.md` and PASS against the real one. A suite that passes everything is indistinguishable from one that grades nothing. |
| committed-vs-explored grading | `must_not_contain` matches only what the agent COMMITTED to (final answer + executed queries); `must_use` matches everything it touched. Reading a binding's definition is not re-deriving it — `average_order_value` is literally defined as `total_sales / order_count`, so compile output echoes the forbidden pattern back at a correct agent. Originally shipped as authored-vs-read, which still included compiles; narrowed to committed-vs-explored by EVAL-7. |

## Phase 2b — fixes from the first sweep review (evidence: `evals/results/2026-07-28T17-35-59Z.jsonl`)

Findings from reviewing the shipped harness against its own first full sweep
(5 cases x 3 runs, 4/5 passed, $9.66, 6.5M tokens, 24.7 min). Ordered by
priority: the first two distort the signal the loop exists to produce, so they
come before anything else including performance.

| Code | Item | Detail | Effort |
|---|---|---|---|
| EVAL-7 | `must_not_contain` scope — false positive — DONE | The only failing run (`no-rederivation-margin` run 3) is almost certainly a grader error: its final answer and BOTH executed queries use the governed binding (`product_performance -> { aggregate: margin }`); the forbidden pattern appears nowhere in either. It matched in `authoredText`, which also carries **compile-stage** tool inputs and intermediate prose — runs 1-2 made 3 Malloy calls, run 3 made 4, so one extra *compile* (explaining or testing an expression it then correctly discarded) failed the case. Exploration is not commitment. **Fix:** match `must_not_contain` against executed queries (`RUN_TOOLS`) + the final answer only; keep `must_use` searching the full trace. **Also:** record the matched snippet with ~200 chars of context in the result row — today the telemetry cannot adjudicate its own verdict. | done |
| EVAL-8 | `last_validated` stamping poisons the identity signal — DONE | `run.js` writes the date into `kp/**` after a passing run; `identity.js` digests the `kp/` working tree. Every successful sweep therefore changes `semantic_identity`, and the next `eval:report` announces "the MEANING moved" when only a date moved — the exact false signal EVAL-6 exists to prevent. **Fix:** strip `last_validated:` lines in `treeDigest`, and exclude `kp/agent/gap-log.md` + `question-log.md` (appending a gap does not change meaning). Keep `examples.md` and `corrections.md` standing hints IN — those do. **Also fixed:** the `dirty` flag ignored the same files and any concept file whose only diff from HEAD is its stamp — a flag reporting drift the hash ignores is a second false signal. | done |
| EVAL-9 | `subset` verdict is unsound — DONE | `containsAll` compares *flattened* value multisets, so gold values found anywhere in the agent's output pass: a gold scalar of `47` passes against any 200-row result that happens to contain a 47. **Fix:** column-aware containment (gold columns subset of agent columns, matched per key), or make `subset` opt-in per case instead of a default pass tier. The tier's rationale (agents legitimately return extra context) is right; the implementation is too loose. **Shipped both:** containment is now column-and-row aware — extra *columns* pass, extra *rows* do not (a different row count is a different grain). Leftover column names are searched, not guessed, so the agent may still alias output (`category_margin is margin`) without failing; a same-named column that disagrees is never re-mapped to one that agrees; the search is bounded (≤3 unmapped, ≤8 spare). Plus `min_match: subset\|values\|exact` per case (default `subset`) for cases that want the shape pinned harder. Verified on the real `membership-verbatim` gold: scalar 31576 padded with 50 rows was `subset`, now `none`. | done |
| EVAL-10 | `analysis` cases can be vacuous — DONE | `grade.js` returns `pass: true` for the kind and lets cross-checks decide, but `cases.js` never requires any. An `analysis` case with empty `must_use`, empty `must_not_contain` and no `expect_receipt` passes unconditionally, forever, while looking like coverage. **Fix:** load-time error when an `analysis` case carries no cross-check. Both committed `analysis` cases already carry them, so the suite is unaffected — the guard is for the next one. | done |
| AGT-3 | Cheap refusal (protocol fix, found by telemetry) — DONE | `refusal-ungoverned` burns 18-24 turns and $0.76-0.91 per run to conclude a term is not governed — more than the case that actually computes a number, and the second most expensive case in the sweep. Every real user asking about an ungoverned term pays the same. **Fix:** one line in CLAUDE.md — *absence from the routing table is conclusive; do not explore the models to confirm a term is missing.* Add a `contains`-style assertion that the refusal is reached cheaply (cap `--max-turns` for that case, or assert `malloy_tool_calls <= 1`). Eval cost is a sensor for protocol waste. **Diagnosis corrected on inspection:** the trace shows only 3 executed queries out of 7 Malloy calls, and they compute a well-formed *exploratory CLV* — which CLAUDE.md explicitly sanctions for an ungoverned term (tier 3). Most of that spend is the sanctioned computation, not confirmation of a gap, so `malloy_tool_calls <= 1` would have failed correct behaviour. **Shipped:** the CLAUDE.md line as specified (absence is conclusive; inspect a source only to compute an exploratory figure already decided on), plus a `max_malloy_calls` cross-check and a new companion case `refusal-routing-decision` that asks ONLY the routing question — no number in the right answer — with a budget of `0`. Cheapness is asserted where cheapness is genuinely required. | done |
| EVAL-11 | Numeric extraction fragility (confirmed) — DONE | `aov-synonym` extracted via `currency` twice and `bold` once across three identical questions — it survived on the luck of answer ordering, and the first answer that leads with a different figure breaks it. **Fix (in order of preference):** prefer `query_shape` for anything that can be method-graded; where a number genuinely is the point, extract the figure nearest a case-specified label rather than the first match, and keep recording `how`. Do not bend CLAUDE.md into emitting a machine-readable fence just to suit the grader — that is the test changing the product. **Shipped the preferred fix only, and that is the whole fix:** `aov-synonym` converted to `query_shape` against its existing gold. The second option was deliberately NOT built — it hardens `extractNumber`, which the conversion leaves with zero callers (it was the only `numeric` case) and which SIMP-1 deletes. Verified on real data: the trajectory all three runs actually executed (bound measure + `total_sales` + `order_count`, filtered to 2023) scores `subset`. **Tradeoff accepted:** the case now also asserts shape — computing AOV for every year and reading the 2023 row off scores `none` — and no longer checks the figure quoted in the prose. | done |
| EVAL-12 | Make the suite cheap enough to run on every PR | Today: serial, no caching, no tiering. 5 cases x 3 = 24.7 min / $9.66, which is ~2.5 h / ~$58 at the EVAL-5 target of 30 cases. Four independent levers, in leverage order: **(a) tiering** — most cases test a *decision*, not a trajectory: tier 0 (no LLM: gold compiles, every approved concept has a binding — belongs in `build.js`), tier 1 (one call, no tools: routing table + question -> "which concepts, what Malloy?", graded on `must_use`/`must_not_contain`/query shape, ~seconds), tier 2 (full agentic, only where multi-turn behaviour IS the test — self-verification, the projection case, logging discipline; ~5 of 30). The 21-turn refusal is the proof: 627k tokens to observe a turn-one decision. **(b) impact selection** — EVAL-6 identity is already a cache key: unchanged identity + unchanged case = unchanged result, so a PR runs only cases whose `must_use` intersects the changed concepts, plus last run's failures; full sweep nightly. **(c) prompt caching + Batch API** on the shared CLAUDE.md + routing-table prefix. **(d) `--concurrency`** — the boring 4x; runs are independent and the grader shares no state. **Invariant:** every cheap tier must be periodically validated against the expensive tier it replaces (correlation check in the nightly sweep), or you get a green suite over a wrong product. | 2-3 days |
| EVAL-13 | Minor harness fixes — 2 of 3 DONE | `ALLOWED_TOOLS` omits `mcp__claude_ai_Malloyyo__query` although `RUN_TOOLS` recognises it — Malloyyo runs would be blocked at the tool gate. **Done**, together with `describe_source` / `list_sources`: CLAUDE.md requires inspect-before-run, so allowing the query alone leaves the runtime broken a different way. A test now asserts every `RUN_TOOL` is allowed at the gate. `--live` still stamps `last_validated` from non-fixture data. **Done** — suppressed unconditionally under `--live`, including against an explicit `--stamp`, and announced in the summary. `report.js` splits one diagnosis sentence across two `if` chains — **deliberately NOT fixed: SIMP-2 replaces all 157 lines of `report.js` with `evals/results.malloy`.** Folded into SIMP-2. | 2/3 done |

**Not adopted from the "fastest eval ever" proposals** (recorded so they are not
relitigated): a local quantized SLM as the CI agent — you ship Claude, and
protocol behaviour is model-coupled, so an 8B model would pass rules Claude
ignores and fail rules Claude follows; use a smaller model in the same family
(Haiku) if a cheap LLM tier is wanted, and validate correlation. Strict AST
equality as the primary query check — it is stricter than semantic equivalence
(the two accepted margin queries in the real session have different trees and
identical meaning), so use it only as a fast-path: identical AST -> pass, else
escalate to execution. Vector/cosine routing as the *test* — it measures whether
definitions are distinguishable in embedding space, not what the agent does; keep
it as a build-time lint for concept pairs too similar to disambiguate (the "too
similar" failure mode), never as a merge gate.


## Phase 2c — Simplification (mostly a side effect of EVAL-12, not a refactor for its own sake)

The harness is ~10 files. About half of that complexity exists for ONE reason:
it grades a *trajectory* (free-form prose from a 20-turn subprocess) instead of
a *decision*. Both bugs found in review (EVAL-7 scope, EVAL-11 extraction) live
in exactly that code — they are the tax on the format, not sloppiness. Test at
the level where the messy code is unnecessary and it deletes itself.

**Do not do this as a standalone refactor.** SIMP-1 falls out of EVAL-12; the
rest are small and opportunistic. What exists works and just produced a real
finding about the protocol.

**Which Phase 2b work SIMP would have thrown away** (checked against the code,
not assumed — the question "should we skip the EVAL fixes if SIMP overwrites
them?" is a good one and the answer is: only twice):

- `report.js` (EVAL-13c) — SIMP-2 deletes the file. Not fixed; folded in.
- `extractNumber` (EVAL-11's second option) — SIMP-1 deletes the regex ladder,
  and EVAL-11's *first* option removed its last caller anyway. Not built.
- Everything else survives, because SIMP-1 does not delete `agent.js` — it
  narrows the blast radius to the ~5 tier-2 cases that still need a trajectory.
  `ALLOWED_TOOLS`, stamping, `compareResults`, the cross-checks and case
  validation are all on the surviving path. `compareResults` gets *more*
  load-bearing: tier 1 grades on `must_use` / `must_not_contain` / query shape.
- AGT-3's `max_malloy_calls: 0` becomes structural rather than asserted —
  tier 1 has no tools, and `refusal-routing-decision` is a tier-1 case by
  construction. The assertion stops costing anything to enforce.

| Code | Item | Detail | Trigger |
|---|---|---|---|
| SIMP-1 | Decision-grading deletes the trajectory layer | EVAL-12's tier 1 (one call, no tools, structured JSON out: "which concepts, what Malloy?") removes the need for stream-json parsing, tool-call extraction, authored-vs-trace splitting (`agent.js`) and the numeric regex ladder (`grade.js`) on most cases — along with both bug classes above. Keep the full agentic path only for the ~5 cases where multi-turn behaviour IS the test (self-verification, projection, logging discipline). | with EVAL-12 |
| SIMP-2 | Report in Malloy, not JavaScript | Results are JSONL; DuckDB reads JSONL natively; we own a semantic layer. Replace `report.js` (~150 lines of hand-rolled grouping and diffing) with `evals/results.malloy`: measures for pass_rate, flakiness, cost_per_case, flips by category. Side effect: the agent can analyse its own eval history with the exact tool under test — dogfooding, and one fewer bespoke reporter to maintain. | opportunistic (small) |
| SIMP-3 | One shared Malloy lib | `build.js` and `evals/lib/malloy.js` both implement "compile every model, index which file defines which source, run a query in the right model context". Duplicated logic with independent drift risk. Extract once, import twice. Confirmed still true: `build.js:52-63` and `malloy.js:42-79` are the same connection -> `loadModel` -> index-`explores` sequence, ~30 lines. | **fired** (EVAL-9 touched `malloy.js`) — take it with SIMP-4, which moves tier-0 checks into `build.js` anyway |
| SIMP-4 | Tier-0 checks fold into `build.js` | "Gold queries compile", "every approved concept has a binding" is validation — which is what `build.js` already is, and it already gates PRs (OPS-1). Most of `eval:check` disappears into the existing gate instead of being a second one. | with EVAL-12 tier 0 |
| SIMP-5 | `selftest` becomes a flag, not a file | It is "run 2 cases against a different protocol file": `run.js --protocol <path>`. Keep the idea — it is the best thing in the harness — delete the separate script and its backup/restore/SIGINT dance. | with SIMP-1 |
| SIMP-6 | **Snapshot + diff instead of authored assertions** (the out-of-the-box one) | Replay-and-diff, not assert. Every `question-log.md` entry is already a real question with a real answer and the concepts it used; promote human-accepted ones into snapshots. The suite becomes: replay the last N accepted questions, diff each new answer against its snapshot, show a human only what MOVED — with `semantic_identity` saying whether the move was legitimate (a definition changed) or a regression (nothing changed but the number did). No `expect_kind`, no gold values, no extraction regex, no assertion vocabulary. The suite grows itself from production, which is what EVAL-5 currently asks humans to do by hand. **Caveats:** snapshots enshrine yesterday's answer as truth — only human-ACCEPTED answers become snapshots, and a filed correction overwrites one; and diff the STRUCTURED part (concepts used, executed Malloy, headline figure), never the prose, or the noise buries the signal. **Keep assertion cases** for the handful of things worth pinning hard: refusals, membership rules, the two known regressions. | hand-authoring toward ~30 cases starts to feel like the bottleneck |


## Phase 3 — Server adoption (Publisher or Malloyyo; pick one)

| Code | Item | Detail | Effort |
|---|---|---|---|
| INT-1 | #(doc) stamper in build.js | For every `# concept`-annotated field, insert/refresh a `#(doc)` line from the KP definition (+ units, membership rules). Idempotent, regenerated per build. Governed definitions become the server's own discovery surface (getContext / describe_source). Runtime-independent — pays off regardless of pick. | 0.5 day |
| INT-2 | CLAUDE.md → skill | Reshape as kp-analysis/SKILL.md (also completes GOV-1). On Publisher it composes with their skills (theirs: query craft; ours: routing/governance); standalone elsewhere. | 0.5 day |
| INT-3a | Publisher wiring | publisher.json; flat layout; map allowed_roles → internal:/private:/required filters (or GOV-3 givens) + build check (declared vs enforced). | 1-2 days |
| INT-3b | Malloyyo wiring | index.malloy; `node build.js` as pre-push gate; define views for canonical questions (restricted-mode surface enforces "no invented joins" structurally). | 1-2 days |
| INT-6 | Currency param → given | Migrate `order_line_in_context(reporting_currency::string)` to `given: REPORTING_CURRENCY :: string is "USD"` — session-scoped by nature ("one value everywhere", per the givens doc's own criterion), removes instantiation syntax from the agent's world, aligns with Malloyyo's direction, valid on any runtime. Rule: every analysis-facing given carries a default (satisfiability). Do together with INT-3, whichever track. | 0.5 day |
| INT-4 | claude.ai degraded mode | Project knowledge = kp/index.md + skill (routing works); logs read-only there, or add GitHub MCP so log appends become commits. | 0.5 day |
| INT-5 | Two-sided receipts | Server query logs (Malloy that ran) + question-log (question, concepts, method) = full provenance. Document the pairing; no new code. | doc only |

## Phase 3b — Bootstrap a new domain (agent-authored, human-ratified)

| Code | Item | Detail | Effort |
|---|---|---|---|
| BOOT-1 | Conceptual doc -> draft KP | Skill/prompt: given a human-authored conceptual model (concepts, definitions, relationships) in any text form, emit an OKF bundle — files, frontmatter, folder tier, relationships, kebab URIs, from `_templates/`. Everything lands `status: draft` (only `approved` reaches the governed surface). Agent MUST output a confidence table flagging every definition where it filled a gap the source left open. Transcription, not invention. | 0.5 day |
| BOOT-2 | KP + schema -> Malloy scaffold | From the bundle: entities -> source stubs, `of:` -> dimension placement, relationships -> join stubs, measures -> stubs — all pre-annotated with `# concept` (the annotation discipline is the forgettable part; generate it). Then, given the physical schema, the agent proposes bindings and measure expressions. Compile + cardinality probes (`join_one` vs `join_many`) + gold numbers verify the proposal. | 2-4 days |
| BOOT-3 | Human ratification gate | What stays human: grain decisions, in-context source design, currency mechanics, choosing the authoritative table among candidates, and all approval. Agent authors both artifacts; agent approves neither (see LLM boundary). Draft -> governed is steward review + gold-number verification, measured in days — that is the feature, not the bottleneck. | process |
| BOOT-4 | Bootstrap from reviewed dashboards | Where a reviewed dashboard exists, reverse-engineer it: KPIs -> measures, filters -> defined classes, and its numbers are free gold answers for EVAL-1. Rank source queries by trust (dashboard-backed > one-off exploratory). Best entry point for a new enterprise domain with no modeling practice. | 2-3 days |

## Phase 4 — Optional / triggered, not scheduled

| Code | Item | Trigger |
|---|---|---|
| OPT-1 | Adversarial review step (reviewer sub-agent challenges final answers; Anthropic: +6% accuracy, +32% tokens, +72% latency) | evals plateau below target |
| OPT-2 | Standalone visualizer (self-contained make_viz, no knowledge-catalog clone; can style declared vs derived edges, statuses) | graph becomes a regular business-review artifact |
| OPT-3 | Hierarchical bundle walk replaces read-whole routing table | routing table outgrows a single read (~hundreds of concepts) |
| OPT-4 | Coverage-warning tuning (flag only derived fields, not raw columns) | already identified; fold into next build.js touch |
| OPT-5 | Change classification + impact detection: compare old vs new KP state and classify each concept change as IDENTICAL / ADDITIVE / BREAKING / UNRELATED (derivable from frontmatter — synonym added = additive; membership_rule, definition, of, preferred_source changed = breaking). CI gates BREAKING hard, lets ADDITIVE through; BREAKING re-runs affected evals (via must_use). Beats a raw diff, which cannot tell the two apart. | after EVAL-1 |
| GOV-3 | RLAC via inline givens + finalizeGivens | First concept whose `allowed_roles` actually matters. `##! experimental.givens`: host supplies CAPABILITIES; `inline CAN_READ_X :: boolean` gates sensitive sources; `finalizeGivens` blocks per-query override — the agent becomes an untrusted caller that cannot bypass the gate. Runtime-neutral (works via malloy-config.json on local MCP too) — supersedes waiting for Publisher's `private:`. Build check: every allowed_roles concept maps to a gated source. Feature is experimental; re-verify syntax at build time. |
| GOV-4 | Per-user context personalization (aliases + defaults) | Let a user personalize the **resolution** layer only, NEVER the **definition** layer. A typed operational doc (`type: profile`, one per user, e.g. `kp/agent/profiles/<user>.md`) carries (a) **aliases** mapping the user's own vocabulary to an existing approved URI (`GMV -> kp:TotalSales`, `contribution -> kp:Margin`) and (b) **defaults** for knobs that already exist (default domain lens for ambiguous labels, currency/units, receipt verbosity). The agent expands aliases at routing time BEFORE matching the routing table. It reuses machinery that already exists: aliases are the ungoverned per-user counterpart of the governed `synonyms` field. **DO:** validate every alias target resolves to an `approved` URI (deterministic build check, same discipline as `# concept` / `preferred_source`; an alias to a non-existent concept -> gap-log, not a silent new meaning); disclose alias use in the AGT-1 answer receipt (`resolved "GMV" -> kp:TotalSales via your profile`); on collision with a governed label/synonym, **governed wins** and the agent states which it applied (same rule as global-vs-local); add a "shared aliases" report so an alias many users independently add becomes a reviewed PR that promotes it into the concept's governed `synonyms` (mirrors the domain->global promotion path — personal context becomes a harvesting ground for governed vocabulary, like the gap-log). **DO NOT:** let a profile carry a definition, membership rule, threshold, filter, or binding — that is a plural/shadow definition (explicit non-goal). A user who wants a genuinely different meaning gets a NEW distinct URI via the draft->approve path, not a personal override. **DO NOT** let the profile become a per-user KP fork: it only POINTS AT governed concepts, never redefines, filters, or forks them. Net effect: personalization changes what the agent understands *from that user*, never what it computes or what others see — a lens, not a lever. Fits the LLM boundary (agent proposes aliases/promotions; build validates; humans ratify promotions). **Trigger:** after EVAL-1, so alias impact on resolution is measurable; and real demand for user/team vocabulary. |
| OPT-6 | Excel authoring surface — REVIVED (v10) | Real steward pushback on editing markdown. `excel_to_okf.py` (archived, v5/v6) still works and preserves write-backs. Hard rule if revived: Excel becomes the SOLE write path for the frontmatter fields it owns — no mixed hand-editing, or the two paths silently fight. | 0.5 day |

---

## Explicit non-goals (decided, don't relitigate)

- No context platform purchase; no dependency graph beyond references;
  no federated/plural definitions; no TMDL/DAX emitter; no join map in the
  routing table (servers' describe_source covers it); no vector/RAG retrieval
  over the KP.

## LLM boundary (decided)

The agent may propose intent, analyses, and candidate meaning (gap-log entries,
question-log, correction reports, draft concepts). Every *trust* decision —
validation, compatibility classification, coverage, drift, eval scoring — is a
deterministic artifact checked mechanically by the build. No trust decision is
ever delegated to a model.

## Givens usage rule (decided)

Givens are for what the agent must NOT control (tenancy, roles, row caps —
finalized), with defaults on everything else; plain `where:` remains the
agent's tool for everything it freely explores. Do not parameterize
exploration.

## Order of operations

Phase 1 → DONE. Phase 2 (eval loop) → DONE and running.
EVAL-7 and EVAL-8 → DONE (the signal-distorting pair; measurements from here on
are trustworthy). EVAL-9 and EVAL-10 → DONE (soundness: no more passing on a
number found anywhere, no more cases that cannot fail). AGT-3 → DONE.
EVAL-11 → DONE (by case conversion). EVAL-13 → 2 of 3, the third folded into
SIMP-2. **Phase 2b is closed except EVAL-12.**
**Now:** EVAL-12, carrying SIMP-1/4/5 (and SIMP-3, whose trigger has fired).
Concurrency is the cheap 4x, tiering is the real 20x. Doing EVAL-12 *without*
SIMP-1 is the actual waste — it would build tiering and leave the trajectory
layer standing.
**Before trusting the next sweep:** `refusal-routing-decision` is unvalidated —
its `max_malloy_calls: 0` budget asserts behaviour nobody has observed yet, and
`aov-synonym` has not been run since converting to `query_shape` (its gold and
the trajectory all three prior runs took were checked directly against the
fixtures, but not end-to-end through an agent).
**Then:** pick a server — INT-1/INT-2 first (both runtime-independent), then
INT-3a or INT-3b with INT-6.
**Continuously:** EVAL-5 harvesting toward ~30 cases; every correction filed gets
an eval case in the same PR.
**On trigger only:** Phase 2c (simplification — SIMP-1/4/5 ride along with
EVAL-12, SIMP-2/3 are opportunistic, SIMP-6 when authoring cases becomes the
bottleneck), Phase 3b and Phase 4.
