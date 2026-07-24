
## Phase 1 — Now (hours, no dependencies)

| Code | Item | Detail | Effort |
|---|---|---|---|
| GOV-1 | Profile for CLAUDE.md — DONE | Frontmatter added to CLAUDE.md: owner, status, approved_by, timestamp (owner/approved_by = Knowledge Plane). The most powerful context file must not be the least governed. | done |
| GOV-2 | Global/local tiers — DONE | `global/` folder (renamed from core) = company-wide definitions; domain folders = local. Promotion path: shared-concepts report flags candidates → reviewed PR moves the file. Same label, different meanings = distinct URIs; ambiguous labels resolve to global. One definition per URI stands. | done |
| AGT-1 | Provenance footer — DONE | CLAUDE.md "Answer receipt" section: every answer ends with basis (governed measure / exploratory), data freshness (max date used), concept steward. Main mitigation for silent wrong answers; the "answer receipt". | done |
| AGT-2 | "Don't bail early" rebuttals — DONE | CLAUDE.md pre-rebuttal block in the Analysis-freedom section: the excuses for abandoning governed measures ("needs a custom date window", "needs a join", "needs a ratio" — none justify raw-column improvisation). | done |
| OPS-1 | CI workflow — DONE | `.github/workflows/build.yml`: runs `npm run build` on every PR + pushes to main; fails on validation errors; fails if the working tree is dirty after build (forces committed write-back). Turns every guarantee in this repo from convention into gate. | done |
| OPS-2 | Steward onboarding + README refresh — DONE | `docs/steward-onboarding.md`: how to add/edit a concept (template, frontmatter, PR, what each build error means). README rewritten for the OKF-bundle reality (MOTLY/knowledge_map.json era removed). | done |

## Phase 2 — Next (the load-bearing build: eval runner)

| Code | Item | Detail | Effort |
|---|---|---|---|
| EVAL-1 | Eval runner | Loop `kp/agent/evals/*.md` through headless Claude Code; score numeric/refusal/contains; write per-case results. Closes the learning loop, enables definition-change impact detection, stamps `last_validated`, powers drift runs. Everything else assumes it exists. | 1-2 days |
| EVAL-2 | Anchored ground truth | Pin evals to a snapshot date OR grade the gold_query rather than the number (gold_query field already supports this). Evals must not rot when data moves. | with EVAL-1 |
| EVAL-3 | Results as telemetry | Each run records: git SHA of kp/, model ID, runtime, per-case pass/fail, tokens, latency — appended to a results file/table so regressions become a query. | with EVAL-1 |
| EVAL-4 | Fixture data for CI | Commit small sample parquets; evals run hermetically in CI on fixtures, on live data for scheduled drift runs. (Malloyyo fixtures pattern.) | 0.5 day |
| EVAL-6 | Semantic identity hash | Hash that identifies the *meaning* a number was produced under: canonical KP content (git SHA of `kp/`) + model files + execution context (malloy version, duckdb version, dialect, runtime settings). Stamp it on every eval result and answer receipt. Makes drift diagnosable: same identity + different number = the data moved; different identity = the meaning moved. (Joe Reis, contract-digest pattern.) | 0.5 day |
| EVAL-5 | Seed from real usage | Freeze the "2023 situation + 2024 prediction" trace as an eval (tier-boundary + coverage-anchoring); keep harvesting question-log/corrections entries into cases. | ongoing |

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

Phase 1 this week → EVAL-1..3 next → pick a server, INT-1/INT-2 first (both
runtime-independent-ish), then INT-3 → everything else on trigger.
