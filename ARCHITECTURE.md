# Architecture & build (v7 — simplified)

Two things in git, one command, links between them.

## A) Knowledge Plane — `kp/` (OKF bundle)

Hand-edited markdown files (VS Code / Obsidian / OWOX Model Canvas), one concept
per file, versioned in git. Folder = domain = steward. Identity = `uri:`
frontmatter. Frontmatter: uri, type (entity | defined_class | measure |
attribute), title, description, synonyms, steward, subtype_of, of (attribute →
entity attachment), membership_rule, preferred_source, allowed_roles,
last_validated (eval-runner-stamped), status (draft | in_review | approved |
deprecated), tags. New concept = copy from `_templates/`. Files with any other
`type` are operational docs, not concepts:

- `kp/agent/examples.md` — canonical query shapes the agent copies
- `kp/agent/gap-log.md` — agent-appended terms with no concept (demand-ranked backlog)
- `kp/agent/corrections.md` — steward-confirmed wrong answers + standing hints
- `kp/agent/evals/*.md` — gold-number cases (question, expected value, gold query)

## B) Malloy models — `models/` + data

Hand-written. Base model holds plumbing; department models import + extend.
Served via Malloyyo, Malloy Publisher, or local malloy MCP — the plane is
runtime-neutral (it's just files + CLAUDE.md).

## C) Links

Declared in Malloy (`# concept = "kp:..."` on sources/fields, `# is_about_role`
on joins) — owned by developers, guarded by the compiler. Projected back into
the plane by the build: every concept file gets its Implementations table, and
the root `kp/index.md` becomes the agent routing table (concept | kind | status
| definition | binding) plus data coverage and the views inventory. There is no
separate knowledge_map.json — the bundle IS the agent context.

## Build: `node build.js`

1. Load + validate bundle (frontmatter, unique URIs, subtype/of/relationship targets).
2. Compile every model (imports resolve; annotations via the Annotations API).
3. Referential validation, hard fail: every annotation resolves; every
   preferred_source resolves to a real (model, source).
4. Drift sensor: declared `of:` vs the entity of the source the field is
   actually implemented on -> WARN.
5. Coverage: approved-but-unbuilt concepts; built-but-ungoverned fields
   (no # concept annotation) -> WARN.
6. Write-back: Implementations tables, routing table (root index), domain
   indexes, data coverage (min/max of bundle.yaml `temporal_anchor`), views.
7. Regenerate `kp_viz.html` (needs GoogleCloudPlatform/knowledge-catalog cloned;
   `--conceptual` variant available via make_viz.py directly).

CI: run build on every PR; fail on errors; fail if the working tree is dirty
after build (forces committed write-back). CODEOWNERS per domain folder.

## Agent protocol

`CLAUDE.md` — routing via the root table, bindings resolve concept -> field,
membership rules via bound measures, time windows anchored to data coverage,
gap-log + corrections write-path, runtime-neutral execution rules.
