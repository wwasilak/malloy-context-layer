# Architecture & build

Two things in git, one command, links between them.

## A) Knowledge Plane — `kp/` (OKF bundle)

Hand-edited markdown files (VS Code / Obsidian / OWOX Model Canvas), one concept
per file, versioned in git. Folder = tier: `global/` = company-wide definitions
(no single domain steward); `sales/`, `finance/`, `merchandising/`,
`operations/` = local, one steward each. Identity = `uri:`
frontmatter. Frontmatter: uri, type (entity | defined_class | measure |
attribute), title, description, synonyms, steward, subtype_of, of (attribute →
entity attachment), membership_rule, preferred_source, allowed_roles,
last_validated (eval-runner-stamped), status (draft | stable | deprecated —
OKF v0.2 lifecycle), generated (`{ by, at }`, who/when authored the content),
verified (`{ by, at }` or a list — **the actual governance gate**: the agent
routes to a concept only when it is `status: stable` AND has a `human:`
`verified` entry), tags. New concept = copy from `_templates/`. Files with any
other `type` are operational docs, not concepts:

- `kp/agent/examples.md` — canonical query shapes the agent copies
- `kp/agent/gap-log.md` — agent-appended terms with no concept (demand-ranked backlog)
- `kp/agent/question-log.md` — novel analyses the agent logged (promotion candidates)
- `kp/agent/corrections.md` — steward-confirmed wrong answers + standing hints

Eval regression cases are NOT under `kp/`: they live in `evals/cases/*.md`
(harness fixtures, outside the tree the agent explores — EVAL-18). See the
operational docs list in CLAUDE.md.

### Global vs local concepts

One definition per URI, always. Same label with genuinely different meanings =
distinct URIs; the agent resolves ambiguous labels to `global/` unless the
question names a domain, and states which definition it used. Promotion path:
the build's "Shared concepts (>1 model)" report flags domain concepts other
domains have started using — promotion is a reviewed PR that moves the file to
`global/` (identity is the `uri:`, so links don't move). The build detects
candidates; humans promote.

### Authoring surfaces

The bundle is canonical. Two ways in, one write path at a time:
- **Direct edit** (default): VS Code / Obsidian on `kp/**`, reviewed via PR.
- **Excel round-trip** (for stewards who won't touch markdown):
  `python3 scripts/okf_to_excel.py` exports the bundle to `knowledge_plane_workbook.xlsx`;
  `python3 scripts/excel_to_okf.py` imports it back (verified byte-identical on a full
  cycle; generated Implementations blocks are preserved). Rule: while a
  workbook cycle is in flight, Excel owns the frontmatter fields it carries —
  do not hand-edit those same files in parallel.

## B) Malloy models — `models/` + data

Hand-written. Base model holds plumbing; department models import + extend.
Served via Malloyyo, Malloy Publisher, or local malloy MCP — the plane is
runtime-neutral (it's just files + CLAUDE.md).

## C) Links

Declared in Malloy (`#(kp) concept = "kp:..."` on sources/fields, `#(kp) is_about_role`
on joins) — owned by developers, guarded by the compiler. Projected back into
the plane by the build: every concept file gets its Implementations table, and
the root `kp/index.md` becomes the agent routing table (concept | kind | status
| definition | binding) plus data coverage and the views inventory. There is no
separate knowledge_map.json — the bundle IS the agent context.

## Build: `node scripts/build.js` (`npm run build`)

All build and authoring scripts live in `scripts/`; they resolve `kp/` and
`models/` against the working directory, so run them from the repo root.

1. Load + validate bundle (frontmatter, unique URIs, subtype/of/relationship targets).
2. Compile every model (imports resolve; annotations via the Annotations API).
3. Referential validation, hard fail: every annotation resolves; every
   preferred_source resolves to a real (model, source).
4. Drift sensor: declared `of:` vs the entity of the source the field is
   actually implemented on -> WARN.
5. Coverage: governed-but-unbuilt concepts (`status: stable` + human `verified`,
   no implementation) -> hard fail; built-but-ungoverned fields (no #(kp) concept
   annotation) -> WARN.
6. Write-back: Implementations tables, routing table (root index), domain
   indexes, data coverage (min/max of bundle.yaml `temporal_anchor`), views.
7. KP stamps (INT-1, `scripts/kp-stamp.js`): write each concept's `#"`
   description and, where field-specific, `#(agent)` instruction into
   `models/` next to its `#(kp)` link. `--check` validates everything and
   writes nothing — the pre-commit hook.

CI: run build on every PR; fail on errors; fail if the working tree is dirty
after build (forces committed write-back). CODEOWNERS per domain folder.

## D) Eval loop — `evals/` (`npm run eval`)

The build proves the plane is internally consistent. It cannot prove the agent
routes correctly, applies membership rules verbatim, refuses ungoverned terms,
or returns the right number — that is this. Cases are `evals/cases/*.md`
(harness fixtures, outside the `kp/` tree so the agent under test can't read
its own answer key — EVAL-18); the runner feeds each
`question` to headless Claude Code in the repo root, so the shipped `CLAUDE.md`
and `kp/` are what gets tested, not a stub.

1. Grade the artifact (`numeric`, `refusal`, `contains`, `query_shape`,
   `analysis`) AND the route (`must_use`, `must_not_contain`, `expect_receipt`).
   The route checks run for every kind: an answer can carry the right number and
   still have re-derived a governed concept from raw columns.
2. `query_shape` runs the agent's Malloy and the `gold_query` against the same
   data and compares result sets — grades the method, survives data movement.
3. N=3 runs per case with a quorum, because the thing under test is stochastic.
4. One JSONL row per (case × run) in `evals/results/`, each stamped with the
   semantic identity hash: `sha256(kp/ + models/ + CLAUDE.md + runtime)`. Same
   identity + different number = the data moved; different identity = the
   meaning moved.
5. Passing cases stamp `last_validated` on their `must_use` concepts (the writer
   of the field described above).
6. Two opt-in economies (EVAL-12b): `--select` skips a case whose per-case
   fingerprint — its file, its `must_use` concepts, the routing surface, the
   standing hints, `models/`, `CLAUDE.md`, the runtime — already has a clean
   measurement on record; `--concurrency <n>` fans runs out after one serial
   run has warmed the shared prompt cache. Neither is on by default.
7. Reporting is itself a Malloy model (`evals/results.malloy`, SIMP-2) rather
   than a bespoke differ: DuckDB reads the JSONL natively, so pass rate,
   flakiness, cost, cache share and flips are measures and views and
   `report.js` only prints them. The eval history is queryable with the tool
   under test.

Data: the committed `data/` are the fixture set — hermetic and
byte-identical in CI. `--live` switches WORKDIR for scheduled drift runs.

CI (`.github/workflows/eval.yml`, separate from the build gate): the
deterministic half blocks (cases parse, gold queries run, no gold drift); the
agent sweep is report-only until its pass rate is stable. Full protocol in
`docs/evals.md`.

## Agent protocol

`CLAUDE.md` — routing via the root table, bindings resolve concept -> field,
membership rules via bound measures, time windows anchored to data coverage,
gap-log + corrections write-path, runtime-neutral execution rules.
