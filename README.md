# Knowledge Plane + Malloy

A working experiment: use a **Malloy** semantic model as the Data Plane and a
separate, git-versioned **Knowledge Plane** as the meaning layer — business
concepts, definitions and relationships — linked but never duplicated. The idea
comes from Juha Korpela's writing on semantic architecture:

- https://commonsensedata.substack.com/p/the-quest-for-semantic-architecture
- https://commonsensedata.substack.com/p/semantic-linking-the-aboutness-of
- https://commonsensedata.substack.com/p/semantic-linking-managing-mappings
- https://commonsensedata.substack.com/p/building-semantics-with-conceptual

## The shape of it

Two artifacts in git, one build command, links between them:

- **`kp/` — the Knowledge Plane**, an [OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog)
  bundle: one markdown file per concept, YAML frontmatter for identity
  (`uri:`) and governance (`status`, `steward`, …). Folder = tier: `kp/global/`
  is company-wide, the domain folders (`sales/`, `finance/`, `merchandising/`,
  `operations/`) are locally stewarded. Hand-edited, reviewed by PR.
- **`models/` — the Malloy models**, the Data Plane. `base.malloy` holds all the
  plumbing (sources, in-context sources, universal measures); the thin
  department models `import "base.malloy"` and extend it. Fields link to a
  concept with a `# concept = "kp:..."` annotation, so meaning lives in one place.
- **`build.js` — the link.** It validates the bundle, compiles every model,
  checks every annotation resolves to a real concept (and every
  `preferred_source` to a real source), then **writes the mapping back** into the
  bundle: each concept's `## Implementations` table and the root
  `kp/index.md` — the agent's routing table (concept · kind · status ·
  definition · binding) plus data coverage and sanctioned views. There is no
  separate map file; **the bundle is the agent context.**

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
write-back (routing table, Implementations tables, indexes, and — if a
`knowledge-catalog` clone and Python/pyyaml are present — the `kp_viz*.html`
graphs). It **fails hard** on any validation error. CI runs the same command on
every PR and additionally fails if the write-back left the tree dirty — see
[`.github/workflows/build.yml`](.github/workflows/build.yml).

## Where to look

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — how the two planes, the links, and the
  build fit together; authoring surfaces (direct edit vs Excel round-trip).
- **[docs/steward-onboarding.md](docs/steward-onboarding.md)** — add or edit a
  concept: templates, frontmatter, PR flow, what each build error means.
- **[CLAUDE.md](CLAUDE.md)** — the agent protocol: routing, the governance tiers,
  answer receipts, execution rules.
- **[ROADMAP.md](ROADMAP.md)** — what's done and what's next.
- **`kp/agent/`** — operational docs the agent reads and appends to: `examples.md`,
  `gap-log.md`, `question-log.md`, `corrections.md`, `evals/`.

## Notes

- Runtime-neutral: the plane is just files + `CLAUDE.md`. Models can be served
  via Malloyyo, Malloy Publisher, or a local Malloy MCP.
- Built mostly in conversation with Claude. Earlier iterations used a MOTLY
  Knowledge Plane and a generated `knowledge_map.json`; both are gone — the OKF
  bundle replaced them.
