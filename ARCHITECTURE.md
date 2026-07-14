# Architecture & build

Two planes, one build.

## Knowledge Plane — `kp/`

The canonical home of business meaning, as an [OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf)-shaped bundle: one markdown file per concept, YAML frontmatter for the structured fields, prose in the body.

- **Folder = domain = steward.** `sales/`, `finance/`, `merchandising/`, `operations/` hold stewarded concepts; `core/` holds shared, un-stewarded ones.
- **Identity is the `uri:` frontmatter field**, not the file path — files can be moved or renamed freely as long as `uri` is untouched.
- **Frontmatter fields:** `uri`, `type` (entity | defined_class | measure | attribute), `title`, `description`, and optionally `synonyms`, `steward`, `subtype_of`, `membership_rule` (required on every defined_class), `preferred_source`, `relationships` (declared on the domain-side entity), `status`, `timestamp`.
- **Lifecycle:** `status: draft | approved | deprecated`. Only `approved` concepts are published to the agent map; models referencing non-approved concepts produce a build warning.
- **Humans own meaning; the build owns bookkeeping.** Every `index.md` and every `## Implementations` section between the `GENERATED` markers is rewritten by the build — never edit those by hand.
- `bundle.yaml` carries the namespace. `_templates/` has a starter file per concept kind: copy, fill in, set `status: draft`.

## Data Plane — `models/` + `ParquetFiles/`

Malloy models define sources, joins and metrics. `base.malloy` holds all plumbing; department models import and extend it. Models link to the Knowledge Plane with annotations and never define meaning themselves:

```malloy
# concept = "kp:Customer"
source: customer is duckdb.table('ParquetFiles/customer.parquet') ...
```

Joins reference relationships via `# is_about_role = "kp:isPlacedBy"`.

## Linking (hybrid)

- **Fine-grained links live in Malloy** (`# concept` on sources/fields, `# is_about_role` on joins) — owned by developers, guarded by the compiler.
- **Routing links live in the KP** (`preferred_source` in concept frontmatter) — owned by stewards, a governance decision.
- **The build projects the full picture back into the KP**: each concept file gets a generated Implementations table (model / source / field), so the Knowledge Plane reads as one coherent document without anyone hand-maintaining the mapping.

## Build

```bash
npm run build        # node exporter.js, from the repo root
```

1. `okf-lib.js` loads and validates the bundle: frontmatter parses; required fields per type; unique URIs; `subtype_of` and relationship ranges resolve.
2. `exporter.js` compiles every model in `models/` (loaded by URL so imports resolve; annotations read via the Annotations API, never regex).
3. Cross-plane validation, hard fail: every `# concept` / `# is_about_role` annotation resolves to a concept/relationship file; every `preferred_source` resolves to a real compiled (model, source).
4. Emits `knowledge_map.json` — the agent-facing routing map (approved concepts only, no field inventory).
5. Write-back: regenerates all `index.md` files and every `## Implementations` section.

Run from the repo root — DuckDB resolves `ParquetFiles/...` relative to it.

## Workflows

**Add a concept:** copy the matching `_templates/` file into the right domain folder, fill in the frontmatter, `status: draft`. Promote to `approved` when the steward signs off.

**Link it from a model:** add `# concept = "kp:..."` above the source or field. Build fails if the URI has no concept file — creating the meaning always precedes linking it.

**Retire a concept:** set `status: deprecated`. It drops out of the agent map; any model still linking it shows up as a build warning.

**Add a relationship:** add it under `relationships:` in the frontmatter of the *domain-side* entity's file, then reference it from the Malloy join with `# is_about_role`.
