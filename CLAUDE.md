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
  `gap-log.md`, `question-log.md`, `corrections.md` (check Standing hints
  before answering), `evals/`.

## Routing: question -> answer

1. Resolve the question to concepts via the routing table (labels, definitions;
   synonyms are in the concept files). Only `approved` concepts are governed.
   If a label matches concepts in both `global/` and a domain folder, use the
   global one — unless the question names the domain ("sales' definition of…").
   Say which definition was applied.
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

## Analysis freedom: the KP governs definitions, not analysis

Three tiers — know which one you are in:

1. **Governed metrics** (in the routing table): resolve via bindings, apply
   membership rules verbatim. Never redefine one differently.
2. **Analysis OVER governed metrics** — trends, YoY growth, shares of total,
   ratios, projections, decompositions, cohorts, what-ifs. This is your job and
   you have FULL Malloy freedom for it: `calculate:` with `lag()`/`lead()`,
   `all()` for percent-of-total, `nest:` for breakdowns, `pick` for banding —
   see the exploratory patterns in `kp/agent/examples.md`. A projection built
   on kp:TotalSales inherits its governance; do not treat the task as
   ungoverned and do not gap-log analysis verbs (forecast, trend, compare).
   Present with a one-line basis note: which governed metrics it uses and the
   method (e.g. "naive YoY extrapolation of TotalSales").
3. **New metrics improvised from raw columns**: allowed only as clearly labeled
   *ungoverned / exploratory* figures — never presented as official. This is
   the only tier that belongs in the gap log.

**The test that decides the tier — apply it before writing any query:**

> Does a governed concept already exist for the quantity I am about to compute?

- **Yes → use its binding.** Even if the grain differs. Need product-level
  margin but `kp:Margin` is bound on `sales_order`? Reach the grain through
  joins (`group_by: lines.sold_product.ProductName; aggregate: margin`), do NOT
  recompute it from components. Re-deriving a governed concept from its inputs
  (e.g. `sum(line_revenue - line_cost)` when `kp:Margin` exists) is tier 3, not
  tier 2 — it agrees today and diverges silently the day the governed
  definition changes.
- **No → compute it, label it ungoverned, log it.**

A different grain, a custom window, a ratio, or a needed join are NOT reasons
to abandon a governed binding. They are reasons to navigate to it.

## When a term is NOT in the routing table

- If it is a **business metric or entity** someone might govern (e.g. "customer
  lifetime value"): say it is not governed, optionally compute an exploratory
  version (tier 3), and append one line to `kp/agent/gap-log.md`
  (date | term | action taken).
- If it is an **analysis verb or technique** (forecast, trend, YoY): tier 2 —
  just do it. Not a gap.
- If it is **out of scope** for this dataset (personal finances, other
  companies): say so briefly. Not a gap.

## After answering a NOVEL analysis (tier 2 or 3)

- Append one line to `kp/agent/question-log.md` (date | question | concepts
  used | method | tier). Routine lookups of a single governed metric are NOT
  novel - do not log them. Recurring question-log entries are candidates for
  promotion to a governed view or concept.

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
