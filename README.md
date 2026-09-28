# Context Layer (Knowledge Plane) + Malloy Semantic Layer (Data Plane)

This is a second experiment (first one is here: https://github.com/wwasilak/malloy_knowledge_plane) to create working implementation of the idea that comes from Juha Korpela's writing on semantic architecture:

- https://commonsensedata.substack.com/p/the-quest-for-semantic-architecture
- https://commonsensedata.substack.com/p/semantic-linking-the-aboutness-of
- https://commonsensedata.substack.com/p/semantic-linking-managing-mappings
- https://commonsensedata.substack.com/p/building-semantics-with-conceptual

Knowledge Plane (kp, also Context Layer) contains the meaning part – business concepts, definitions, relationships, governance. For this part
Google's Open Knowledge Format is used. As kp can contain hundreds of files, Excel template was also created - it can be generated from kp files and used by the Business Users to fill in the concepts and definitions. Python script extracts the data from Excel and converts it to okf bundle.

Semantic layer is implemented via the Malloy language. Malloy model define sources, joins, measures, dimensions and views. It allows the agent to perform calculations in a repeatable, accurate way.

Concepts in the knowledge plane are linked to objects in the semantic layer. The relationship between those two layer is one-to-many, so concepts are never duplicated. Links, when a question in natural language is asked, allow the agent to quickly route to apropriate Malloy model. 



# Elements of the solution

Two artifacts in git, one build command, links between them:

1. **`kp/` — the Knowledge Plane**, an [OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog)
  bundle: one markdown file per concept, YAML frontmatter for identity
  (`uri:`) and governance (`status`, `steward`, …). Folder = tier: `kp/global/`
  is company-wide, the domain folders (`sales/`, `finance/`, `merchandising/`,
  `operations/`) are locally stewarded. Hand-edited, reviewed by PR.

2. **`models/` — the Malloy models**, the Data Plane. `base.malloy` holds all the
  plumbing (sources, in-context sources, universal measures); the thin
  department models `import "base.malloy"` and extend it. Fields link to a
  concept with a `#(kp) concept = "kp:..."` annotation, so meaning lives in one place.

3. **`scripts/build.js` — the link.** It validates the bundle, compiles every model,
  checks every annotation resolves to a real concept (and every
  `preferred_source` to a real source), then **writes the mapping back** into the
  bundle: each concept's `## Implementations` table and the root
  `kp/index.md` — the agent's routing table (concept · kind · status ·
  definition · binding) plus data coverage and sanctioned views. There is no
  separate map file; **the bundle is the agent context.**

4. **`evals/` — the proof.** The build shows the plane is *consistent*; the eval
  loop shows the agent actually *uses* it: routes to the right concept, applies
  membership rules verbatim, refuses ungoverned terms, and does not quietly
  re-derive a governed measure from raw columns. Cases live in
  `evals/cases/`, results are JSONL stamped with a semantic identity hash, so
  a number that moves can be attributed to the data or to the meaning.

The result is an executable model that is also its own conceptual documentation,
and a routing table an AI agent uses to answer questions from governed
definitions rather than improvised SQL.



## Getting started

From the repo root (DuckDB resolves `ParquetFiles/...` relative to it):

```
npm install
npm run build
```

`npm run build` validates `kp/**` against `models/*.malloy` and regenerates the
write-back (routing table, Implementations tables, indexes). It **fails hard** on any validation error. CI runs the same command on
every PR and additionally fails if the write-back left the tree dirty — see
[`.github/workflows/build.yml`](.github/workflows/build.yml).

The build also **stamps the KP into the models** (INT-1): each `#(kp)`-linked
field and source gets a `#"` description and, where needed, an `#(agent)`
instruction — the annotations Malloyyo serves to agents. Those lines are
generated; change the KP, not the stamp. `npm run build:check` runs every
validation read-only and fails if a stamp is stale or hand-edited. `npm install`
enables it as a git pre-commit hook (`core.hooksPath=.githooks`); bypass in an
emergency with `git commit --no-verify`.

To run the eval loop (needs the `claude` CLI on PATH and the Malloy MCP server):

```
npm run eval:check     # cases parse + gold queries still run — no agent needed
npm run eval           # every case, 3 runs each, against the committed fixtures
npm run eval:report    # pass rate by category + what flipped since last run
```

## Where to look

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — how the two planes, the links, and the
  build fit together; authoring surfaces (direct edit vs Excel round-trip).
- **[docs/steward-onboarding.md](docs/steward-onboarding.md)** — add or edit a
  concept: templates, frontmatter, PR flow, what each build error means.
- **[CLAUDE.md](CLAUDE.md)** — the agent protocol: routing, the governance tiers,
  answer receipts, execution rules.
- **[docs/evals.md](docs/evals.md)** — the eval loop: writing a case, choosing a
  grading kind, anchored ground truth, telemetry, semantic identity.
- **[ROADMAP.md](ROADMAP.md)** — what's done and what's next.
- **`kp/agent/`** — operational docs the agent reads and appends to: `examples.md`,
  `gap-log.md`, `question-log.md`, `corrections.md`. (Eval cases live in
  `evals/cases/`, not here — EVAL-18.)

## Notes

- Runtime-neutral: the plane is just files + `CLAUDE.md`. Models can be served
  via Malloyyo, Malloy Publisher, or a local Malloy MCP.
- Built mostly in conversation with Claude. Earlier iterations used a MOTLY
  Knowledge Plane and a generated `knowledge_map.json`; both are gone — the OKF
  bundle replaced them.
