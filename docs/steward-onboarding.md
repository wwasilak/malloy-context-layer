# Steward onboarding — adding & editing a concept

One page. If you steward business definitions (Sales, Finance, Merchandising,
Operations) this is everything you need to add or change a concept and get it
through the build. You never touch Malloy or code — you own **meaning**
(frontmatter + prose); the build owns bookkeeping.

See also: [ARCHITECTURE.md](../ARCHITECTURE.md) (how the pieces fit) and
[CLAUDE.md](../CLAUDE.md) (how the agent uses what you write).

## The model in one paragraph

The Knowledge Plane is the `kp/` folder: **one markdown file per concept**, with
YAML frontmatter at the top. The folder a file lives in is its **tier**:
`kp/global/` = company-wide definitions with no single owner; `kp/sales/`,
`kp/finance/`, `kp/merchandising/`, `kp/operations/` = local, one steward each.
Identity is the `uri:` field, never the filename or folder. The Malloy models in
`models/` link to your concept by its `uri` (a `# concept = "kp:..."` annotation
a developer owns) — so a definition lives in exactly one place and is never
copied into a model.

## Add a concept (4 steps)

1. **Copy a template.** Start from `kp/_templates/` — pick the one matching the
   kind: `entity` (a thing: Customer, Product), `measure` (a number: Total
   Sales, Margin), `attribute` (a property of an entity: Customer Country), or
   `defined_class` (a filtered subset: Active Customer).
2. **Drop it in the right folder.** A definition everyone shares → `kp/global/`.
   A definition your domain owns → your domain folder. Unsure? Use your domain
   folder; the build flags anything worth promoting to global later.
3. **Fill in the frontmatter** (fields below). Write the `description` as a
   business definition — what it *means*, not how it's computed.
4. **Open a PR.** CI runs the build. Green = your concept is valid and, once
   `status: approved`, the agent can route to it. Merge.

Binding to real data (which model/source/field implements the concept) is done
by a developer in the Malloy model and filled into your file's
`## Implementations` section **automatically** by the build — leave that section
alone.

## Frontmatter fields

Required:

| Field | Meaning |
|---|---|
| `uri` | Stable identity, e.g. `kp:TotalSales`. Never reuse or repoint it. |
| `type` | `entity` \| `measure` \| `attribute` \| `defined_class`. |
| `title` | Human label, e.g. "Total Sales". |
| `description` | One-sentence business definition. |
| `status` | `draft` → `in_review` → `approved` → `deprecated`. **Only `approved` reaches the agent.** |

Common / conditional:

| Field | When |
|---|---|
| `steward` | Who owns it. Required for domain concepts; omit for `global/`. |
| `approved_by` | Who signed off (role or name). |
| `synonyms` | Other terms people use for it — helps the agent resolve questions. |
| `of` | For an `attribute`: the entity it hangs off (e.g. `kp:Customer`). |
| `subtype_of` | This concept specialises another (must be a real `uri`). |
| `membership_rule` | **Required** for `defined_class` — the rule that defines the subset. |
| `preferred_source` | Default `model.source` when several models carry the concept. |
| `allowed_roles` | Restrict who may see the figures. |
| `last_validated` | Stamped by the eval runner — **do not hand-edit.** |
| `tags`, `timestamp` | Labels; date of last meaningful change. |

## Editing an existing concept

Edit the file in place and PR it. Changing `membership_rule`, `description`,
`of`, or `preferred_source` is a **meaning change** — reviewers should treat it
as breaking (existing numbers may move). Adding a `synonym` is additive and
safe. Don't edit anything between the
`<!-- BEGIN GENERATED -->` / `<!-- END GENERATED -->` markers, and don't edit
`index.md` files — the build owns those.

## What the build errors mean

The build (`npm run build`, and CI on every PR) fails hard on these — fix the
named file and re-run:

- **`missing required field 'type' / 'uri'`** — every concept file needs both.
- **`missing 'title' / 'description'`** — fill them in.
- **`defined_class requires 'membership_rule'`** — a subset with no rule isn't
  defined.
- **`duplicate uri kp:X in A and B`** — two files claim the same identity. One
  definition per `uri`; rename one or merge them.
- **`subtype_of 'kp:X' has no concept file`** / **`relationship range 'kp:X'
  has no concept file`** — you referenced a `uri` that doesn't exist. Fix the
  spelling or add the target.
- **`broken YAML frontmatter`** — a typo in the `---` block (bad indentation,
  missing quote). Check the top of the named file.
- **`concept not in KP: kp:X`** — a model links to a `uri` with no file. Usually
  a developer issue, but it can mean a concept file was deleted/renamed.
- **`preferred_source ... not found`** — the `model.source` you named doesn't
  exist. Check the value with a developer.

Warnings (build still passes, but worth acting on): `approved but unbuilt`
(nothing implements this approved concept yet) and `built but ungoverned` (a
model field has no concept — a governance gap).

## Not comfortable in markdown?

There's an Excel round-trip (`okf_to_excel.py` / `excel_to_okf.py`). If a
workbook cycle is in flight, **Excel owns the frontmatter fields it carries** —
don't hand-edit those same files in parallel or the two paths fight. See
[ARCHITECTURE.md](../ARCHITECTURE.md) → "Authoring surfaces".
