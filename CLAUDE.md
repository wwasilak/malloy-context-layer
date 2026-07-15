# Working with the Knowledge Plane + Malloy models

## What you have

- **`kp/` — the Knowledge Plane** (OKF bundle). Start at `kp/index.md`: a generated
  routing table of every concept (uri, kind, status, definition, binding). Read it
  whole. Open a concept file only for more: synonyms, membership rules,
  relationships, the Implementations table, `allowed_roles`, `last_validated`.
- **The Malloy models** (`models/`) — source of truth for execution. The routing
  table's `binding` column (model.source.field) resolves a concept to a field
  directly — do NOT describe/compile just to find a field name. Inspect a source
  only when composing (to browse dimensions) or when a binding is missing.
- **`kp/agent/`** — operational docs: `examples.md` (copy these query shapes),
  `gap-log.md`, `corrections.md` (check Standing hints before answering), `evals/`.

## Routing: question -> answer

1. Resolve the question to concepts via the routing table (labels, definitions;
   synonyms are in the concept files). Only `approved` concepts are governed.
2. Take the field from `binding`; `preferred_source` in the concept file is the
   default source when several models carry the concept.
3. Cross-domain question (concepts bound in disjoint sources)? Use a sanctioned
   view from the routing table header, or the in-context sources
   (`order_line_in_context`, `customer_order_in_context`). NEVER invent a join
   across models. If nothing serves the question, say so.
4. `defined_class` (e.g. kp:ActiveCustomer): use its bound measure. Never
   hand-write the membership filter.
5. **Time:** check the Data coverage line in the routing table. Anchor relative
   windows ("last 2 years") to max_date, not today, and say so in the answer.
6. Respect `allowed_roles` where present: if the requester's role is unknown or
   not listed, do not return that concept's figures.

## When a term is NOT in the routing table

- It is NOT governed. Say so. You MAY explore raw columns to help, but label any
  such figure *ungoverned / exploratory* — never present it as an official metric.
- Append one line to `kp/agent/gap-log.md` (date | term | action taken).

## When the user says an answer was wrong

- Add an entry to `kp/agent/corrections.md` (question, answer, root cause if known).

## Execution rules (runtime-neutral)

Use whichever Malloy tool surface is available — Malloyyo MCP, Malloy Publisher
MCP, or a local malloy MCP in Claude Code. The protocol is the same everywhere:

- Inspect/compile BEFORE running: `describe_source` (server) or `compile` (local).
- Always aggregate/filter, always set a low row limit, never select *.
- Follow the shapes in `kp/agent/examples.md`.

## Malloy dialect gotchas

- `is not null` (not `!= null`)
- `count(x)` for a distinct count (not `count(distinct x)`)
- filter measures via `having:`, dimensions via `where:`
- unsure of syntax -> use the tool's language help
