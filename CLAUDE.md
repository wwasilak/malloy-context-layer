---
owner: Knowledge Plane
status: approved
approved_by: Knowledge Plane
timestamp: 2026-07-29
---

# Working with the Knowledge Plane + Malloy models

## What you have

- **`kp/` — the Knowledge Plane** (OKF bundle). Start at `kp/index.md`: a generated
  routing table of every concept (uri, kind, status, definition, binding). Read it
  whole. Open a concept file only for more: synonyms, membership rules,
  relationships, the Implementations table, `allowed_roles`, `last_validated`.
- **The Malloy models** (`models/`) — source of truth for execution. The routing
  table's `binding` column (model.source.field) resolves a concept to a field
  directly — do NOT describe/compile just to find a field name. Inspect a source
  when composing (to browse dimensions), when a binding is missing, **or when
  the grain or type of a bound measure matters**: the table gives you the name,
  not whether the field aggregates directly at the grain you need. Reaching a
  different grain is a reason to look at the source, never a reason to recompute
  the measure by hand.
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

**Pre-rebuttal — the excuses that do NOT license abandoning a governed
binding. Before improvising from raw columns, check that you are not talking
yourself into one of these:**

- *"It needs a custom date window."* → Apply the window with `where:`; the
  binding is unchanged.
- *"It needs a different grain."* → Reach the grain through joins
  (`group_by: lines.sold_product.ProductName; aggregate: <bound measure>`),
  do NOT recompute from components.
- *"It needs a join the model doesn't have inline."* → Use a sanctioned
  in-context source or view. Never invent a join — but a needed join is not a
  licence to recompute the metric by hand.
- *"It's only a ratio / share / delta / projection."* → That is tier-2 analysis
  built FROM the bound measures (`calculate:`, `all()`, `nest:`), not a new
  metric from raw columns.

None of these justify raw-column improvisation. A different grain, a custom
window, a ratio, or a needed join are NOT reasons to abandon a governed
binding. They are reasons to navigate to it.

**Governance applies to the SLICE as well as the measure.** The tiers above are
usually read as being about what you compute; they apply equally to how you cut
it. A governed measure grouped or filtered by an ungoverned classification is a
**tier-3 answer**, not a tier-2 one — `kp:TotalSales` is governed, "bikes" is
not, so sales-of-bikes is an ungoverned figure however impeccable the measure.

Before slicing, ask the same question you ask before computing: *is this
category a governed dimension?* If it is not:

- Say so plainly, and mark the figure ungoverned in the answer AND in the
  receipt (`Basis: kp:TotalSales (governed), segmented by an UNGOVERNED name
  filter '…'`).
- **Verify what your filter actually matched before reporting on it.**
  `group_by` the matching values and show them. A pattern like `~ '%ike%'`
  matches Nike and Mike as readily as bike; a name match is a guess about a
  category, not a category. Quote the exact filter in the answer so the user can
  judge it.
- Gap-log the missing classification (a product category, customer segment or
  channel someone might govern is exactly what that log is for).

A user asking "do we sell X" where X is not a governed category deserves the
honest version: X is not a category we model, here is what a name match finds,
treat it as exploratory.

## When a term is NOT in the routing table

Two questions, asked in order, each bounded to a fixed amount of work so a gap
resolves in one pass instead of a survey:

1. **Is it governed?** Check the routing table. Absence is conclusive — the
   table lists every governed concept, so a term that is not in it (and not a
   synonym of one) is not governed. This is a table read, never a model
   inspection: no amount of `compile`/`describe_source` on the models can make
   an ungoverned term governed, so searching the models to double-check a gap
   only costs turns and cannot change the answer.
2. **Is an honest exploratory version possible?** Take ONE look at the
   compiled schema (`compile_file`/`describe_source`) of the source(s) the
   quantity would plausibly live on — not a tour of every model, and never the
   raw data files on disk (parquet/CSV listings, grepping filenames). If that
   one look shows no plausible field, say the data isn't there and stop — do
   not keep widening the search hoping to find it somewhere else. If it does
   show a plausible field, compute the figure from it, labelled ungoverned.

- If it is a **business metric or entity** someone might govern (e.g. "customer
  lifetime value" or "returns"): say it is not governed, run step 2, and
  append one line to `kp/agent/gap-log.md` (date | term | action taken) —
  the action taken should say whether an exploratory figure was possible.
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

## When you cannot compute it

Stopping is an acceptable outcome. Guessing is not.

- After roughly three corrective attempts at the same query, stop and report:
  what you were computing, what failed (the error, the syntax you could not get
  right), and what would unblock it. A user can act on a stated problem; they
  cannot act on a number that quietly replaced one.
- NEVER substitute an estimate, an extrapolation from a sample, or a
  back-of-the-envelope calculation for a computation that failed. A wrong number
  carrying a confident receipt is worse than no number, because it is the one
  nobody checks.
- If the obstacle is result size, that is a query problem and not a reporting
  problem — aggregate it in Malloy (see Execution rules).

## Answer receipt (provenance footer)

End every answer that returns a figure with a one-line receipt, so the number
is auditable at a glance. This is the main mitigation for a silent wrong
answer:

`Basis: <governed measure(s) / ungoverned> | Freshness: <max date used> | Steward: <concept steward>`

- **Basis** — name the governed concept(s) the figure resolves to (e.g.
  `kp:TotalSales`), or mark it *ungoverned / exploratory* when it is tier 3.
  For tier-2 analysis, name the governed inputs AND the method
  (e.g. "naive YoY extrapolation of kp:TotalSales").
- **Freshness** — the max date of the data actually used. If a relative window
  was anchored to `max_date` (see Time), say so here.
- **Steward** — the steward of the governing concept, read from its frontmatter.
  `global/` concepts have no single steward — write `global`. This is the one
  part of the receipt you cannot produce without opening the concept file, and
  that is deliberate. Never guess or infer a steward: open the file (it is a
  single read), or write `Steward: not checked` and say why. An invented steward
  is worse than an absent one — it makes an unverified answer look audited.

Example:
`Basis: naive YoY extrapolation of kp:TotalSales (governed) | Freshness: 2024-12-31 (anchored to max_date) | Steward: global`

**A receipt is a claim about how the figure was produced, not decoration.**
Never attach a governed basis to a number you did not compute in this session.
No executed query means you do not have a figure — say what blocked you (see
*When you cannot compute it*). If an order-of-magnitude estimate is genuinely
useful anyway, it is not a figure: say "estimate" in the first sentence of the
answer, write `Basis: estimate — not computed` in the receipt, and never
extrapolate a total from a partial or truncated result set as though it were
one.

Routine single-metric lookups still carry the receipt — it is cheap and it is
what makes a wrong number catchable.

**No figure leaves without one.** Tier 3 and estimates included; they simply
carry a different basis. The receipt is not a formality: it is the only visible
evidence that the governed path was actually walked rather than a plausible
number produced some other way. Everything else in an answer — a concept name,
a field, a query — can be arrived at without ever consulting the Knowledge
Plane. The receipt cannot.

## Execution rules (runtime-neutral)

Use whichever Malloy tool surface is available — Malloyyo MCP, Malloy Publisher
MCP, or a local malloy MCP in Claude Code. The protocol is the same everywhere:

- Inspect/compile BEFORE running: `describe_source` (server) or `compile` (local).
- Always aggregate/filter, always set a low row limit, never select *.
- Follow the shapes in `kp/agent/examples.md`.

**Compute the answer in Malloy, not around it.** Read `kp/agent/examples.md`
before composing anything beyond a single aggregate — those shapes are tested.
If you find yourself exporting rows and post-processing them (in Python, in
bash, by reading a dumped result file, or by reasoning over a truncated sample),
the query is wrong: push the aggregation, ranking, threshold or cumulative
calculation into Malloy and return the answer rather than the raw rows. A result
set too large to read is a signal to aggregate, never a licence to sample. Use
`grep`/`bash` on `models/` only when the routing table genuinely lacks what you
need — the binding column and `describe_source`/`compile` are the supported
route.

Checking whether data exists (e.g. before refusing a gap as uncomputable) is a
schema question, not a filesystem one — see the one-look rule under *When a
term is NOT in the routing table*.

**What you may write.** Only `kp/agent/gap-log.md`, `kp/agent/question-log.md`,
`kp/agent/corrections.md`, and — when explicitly asked — a case under
`kp/agent/evals/`. Never write to `models/`: not a query file, not a scratch
file, not a temporary one. Models are governed implementation and the build
gates on them; compose queries inline instead. Never edit a concept file —
meaning changes go through a reviewed PR by the steward. When you add a query
shape to `examples.md`, compile it first: an example that does not compile
teaches every future session the wrong syntax.

## Malloy dialect gotchas

- `is not null` (not `!= null`)
- `count(x)` for a distinct count (not `count(distinct x)`)
- filter measures via `having:`, dimensions via `where:`
- `~` / `!~` are **overloaded, and the `r` prefix is what switches modes**:
  against a plain string they are LIKE (`%` = any run of characters, `_` = one
  character) — `name ~ 'M%'`; against an `r'...'` literal they are a regular
  expression — `state ~ r'^(CA|NY)$'`. Mixing them fails silently in both
  directions: `~ '^bike'` is a LIKE pattern for a literal caret, and
  `~ r'%ike%'` is a regex for a literal percent sign. Pick one deliberately.
- unsure of syntax -> use the tool's language help
