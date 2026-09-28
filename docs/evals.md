# The eval loop

The build proves the plane is internally consistent: frontmatter validates, URIs
are unique, every `#(kp) concept` annotation resolves, every `preferred_source`
points at a real source. It proves nothing about whether the agent, handed that
plane plus `CLAUDE.md`, actually routes a question to the right concept, applies
a membership rule verbatim, refuses an ungoverned term, or returns the right
number.

That is what this is for. Without it, every "the agent will…" sentence in the
other docs is a claim nobody has tested.

## Commands

```
npm run eval                      # every case, 3 runs each, against fixtures
npm run eval -- --case aov-synonym
npm run eval -- --runs 1          # quick pass
npm run eval -- --live            # scheduled drift run (needs EVAL_LIVE_WORKDIR)
npm run eval -- --model claude-opus-5

npm run eval -- --tier 1          # force every case into the cheap lane
npm run eval:correlate            # run each tier-1 case in BOTH lanes and compare

npm run eval -- --select          # only the cases this change could have moved
npm run eval -- --concurrency 4   # 4 agent calls in flight (first run stays serial)

npm run eval:gold                 # (re)compute expect_value from each gold_query
npm run eval:check                # verify cases parse + gold has not drifted (no agent)
npm run eval:report               # pass rate by case, sweep history, flips
npm run eval:report -- --view cost_by_case   # any view in evals/results.malloy
npm run eval:selftest             # does the harness detect what it is for?
npm run eval:selftest -- --all    # audit EVERY case, not just the two regressions
npm run eval -- --protocol evals/protocols/stripped-analyst.md --case <name>
```

Requires the `claude` CLI on PATH (override with `EVAL_AGENT_BIN`) and the
Malloy MCP server the agent uses to run queries.

## Writing a case

Cases are markdown with YAML frontmatter in `evals/cases/` — deliberately
OUTSIDE the `kp/` tree the agent under test explores, so a run cannot read its
own gold query and reasoning off disk (EVAL-18). `type: eval` in the
frontmatter marks them for the runner.
The body is intent for humans and is never graded.

```yaml
type: eval
title: AOV synonym resolution
category: synonym            # synonym | membership | refusal | tier-boundary |
                             # routing | coverage | computation | projection
question: "What was the AOV in 2023?"
expect_kind: numeric         # numeric | refusal | contains | query_shape | analysis
expect_value: 1964.2507      # numeric: written by eval:gold, never by hand
tolerance: 0.005             # numeric: relative, default 0.005
expect_contains: ["..."]     # contains: substrings the answer must include
must_use: kp:AverageOrderValue        # URIs the trace must reference
must_not_contain: ["total_sales / order_count"]
expect_receipt: true         # assert the AGT-1 provenance footer
min_match: subset            # query_shape: weakest acceptable result-set match
                             # subset (default) | values | exact
max_malloy_calls: 0          # cap the Malloy tool calls the case may spend
gold_query: |                # the verified Malloy behind the gold value
  run: ...
```

`must_use` accepts a list or a comma-separated string. `must_not_contain` is
matched whitespace-insensitively, so `sum(a - b)` and `sum(a-b)` are the same
pattern.

### Choosing `expect_kind`

The two grading philosophies from the spec, plus what they are actually good
for:

| kind | grades | use when |
|---|---|---|
| `numeric` | the final number, within tolerance | a closed historical window with one right answer |
| `query_shape` | the METHOD: agent's query and `gold_query` are both run and their result sets compared | the question has essentially one correct answer shape |
| `refusal` | the answer declines / labels the figure ungoverned | the term is not in the routing table |
| `contains` | required substrings appear | a specific caveat or framing must be stated |
| `analysis` | the cross-checks alone (`must_use`, `must_not_contain`, `expect_receipt`) | the question is open-ended about presentation |

An `analysis` case must carry **`must_not_contain` or `expect_receipt`**, or it
is a load-time error (EVAL-10, tightened by SIMP-5). With no gold artifact and
nothing to cross-check it would pass unconditionally, forever, while looking
like coverage — a test that cannot fail is worse than no test.

**`must_use` does not satisfy that requirement**, and the reason is worth
knowing before writing a case. `must_use` searches the whole trace *including
what came back from tools*, and every approved concept is annotated in some
model file (the build makes "approved but unbuilt" a hard failure), so any agent
that compiles a model gets the required URIs echoed into its trace for free. The
first live selftest after SIMP-5 caught exactly this: `financial-situation-
projection` carried `must_use` and nothing else, and **passed against a
deliberately ungoverned protocol**, emitting no receipt and never reading the
Knowledge Plane.

**`must_use` is no stronger at tier 1**, for a different reason: there are no
tools to echo anything, but the tier-1 prompt *injects the routing table*, so
naming the right concept and its binding is answerable from the prompt itself.
The 2026-08-03 audit found `aov-synonym` hollow on exactly that. Whichever lane
a case runs in, `must_use` alone is not evidence that the agent routed.

### Cost as an assertion (AGT-3)

`max_malloy_calls: <n>` fails a run that spends more than `n` Malloy tool calls.
Use it where the correct answer is a **decision** rather than a computation:
`refusal-routing-decision` asks only whether a term is governed, and the routing
table settles that without a single query, so its budget is `0`.

The point is not to make the suite cheaper — it is that eval cost is a sensor
for protocol waste. Every real user asking the same question pays what the case
pays. The first sweep is what surfaced this: `refusal-ungoverned` spent 18–24
turns and $0.76–0.91 per run.

Read that number carefully, though. Most of it was the *exploratory computation*
CLAUDE.md explicitly sanctions for an ungoverned term (tier 3) — legitimate
spend, not waste — which is why the budget lives on a separate, computation-free
case instead of on `refusal-ungoverned`. Do not put a call budget on a case
whose right answer includes a number.

**`must_use` and `must_not_contain` run for every kind**, and they are the part
that catches the failures actually seen in real sessions. An answer can carry
the right number and still be wrong: a margin re-derived as
`sum(line_revenue - line_cost)` agrees with the governed measure today and
diverges silently the day the definition changes. Number grading cannot see
that. The cross-checks can.

### What each cross-check searches (EVAL-7)

The two search different text, deliberately:

| check | searched | why |
|---|---|---|
| `must_use` | the **whole trace** — prose, every tool call, and what came back from tools | reaching for a concept counts however it shows up; a concept can be used in a query without being named in the answer. **The cost of that breadth:** the models carry `#(kp) concept` annotations, so a compile echoes the URIs back and `must_use` alone cannot prove the agent routed (see above) |
| `must_not_contain` | only what the agent **committed to**: the final answer and the queries it actually executed | exploration is not commitment |

Compiling an expression and then discarding it is the agent working correctly,
and grading it as a violation fails a run for thinking — that is precisely the
false positive the first sweep produced. Tool *results* are excluded for the
same reason from the other direction: `average_order_value` is defined in the
model as `total_sales / order_count`, so any compile output echoes the forbidden
pattern back at an agent that did exactly the right thing.

When a `must_not_contain` does match, the result row records which artifact it
matched (`final_answer` or `executed_malloy[i]`), the matched text, and ~200
characters of surrounding context — a verdict that cannot be adjudicated from
its own row costs a manual transcript re-read.

**Prefer `query_shape` over `numeric` wherever the method can be graded**
(EVAL-11) — not only for time-relative questions. `numeric` grades the number in
the *prose*, which means parsing free text with a regex ladder: `aov-synonym`
extracted its figure via `currency` twice and `bold` once across three identical
questions, surviving on the luck of answer ordering. `query_shape` reads the
number from the executed query, where it is stated exactly. The right fix for a
fragile extraction is a better grading kind, not a better regex — and CLAUDE.md
must not be bent into emitting a machine-readable fence to suit the grader, as
that is the test changing the product.

No case currently uses `numeric`. The kind and its extractor remain for the case
where a number genuinely is the point and no query can be re-run, but they are
unexercised by the suite and are candidates for deletion under SIMP-1.

Prefer `analysis` when several output shapes are equally correct; `query_shape`
on an open-ended question marks correct variants as failures, and a suite that
fails correct behaviour gets ignored.

## The two lanes (EVAL-12a / SIMP-1)

Most cases test a **decision** — which governed concepts does this question
resolve to, and what Malloy follows from their bindings — and that decision is
made on turn one. Watching it play out over twenty agentic turns spends ~600k
tokens to observe something already settled, and drags in the whole
trajectory-parsing layer, which is where both bugs found in the first review
lived.

| lane | how it runs | grades |
|---|---|---|
| **tier 1** | one call, no tools, structured JSON out: the concepts it routed to and the query it *would* run. The harness executes that query against the same fixtures. | the routing decision |
| **tier 2** | the full agentic run | the trajectory — self-verification, iterating on a compile error, logging discipline |

`tier: 1 | 2` per case, **default 2**: a case only becomes cheap when someone
decides it can be. `--tier <n>` forces every case into one lane.

`CLAUDE.md` is neither touched nor injected for tier 1 — it is auto-discovered
from the working directory exactly as in a real session. Tier 1 differs from
tier 2 in **tools and turns and nothing else**, which is the only thing that
makes comparing the two lanes meaningful. The one thing the prompt does add is
notation: a Binding of `model.source.field` is queried as
`run: source -> { … }`. That is not a hint about the answer; it is something the
compiler teaches a tier-2 agent on its first call and tier 1 has had the
compiler taken away. Compensate in the harness for context the harness removed,
never in `CLAUDE.md`.

Tier 1 gets **one compile-repair round**: the harness hands the compiler's own
error back and asks for a correction. It repairs only a query that *fails to
run* — a wrong-but-runnable query is a wrong decision and is graded as one,
never coached into agreement. Repairs are counted on every row; a case that
always needs one is telling you something about the protocol's dialect
guidance, not about the harness.

### Which cases can be tier 1

**Bindings you can aggregate directly.** Anything whose grain or type must be
inspected stays tier 2.

Learned by getting it wrong: `membership-verbatim` was declared tier 1 and moved
back. With only the routing table the agent wrote
`aggregate: is_active_customer` — but that binding is a *boolean* measure
(`made_an_order.count() {…} > 0`), so aggregating it at the top grain asks "did
anyone order?" instead of "how many customers are active". It **runs**, so no
repair round can catch it. Reaching the right grain needs the measure's type,
which lives in the source and not in the table.

### The correlation check (`eval:correlate`)

Tier 1 is a *proxy*. It claims the verdict would have been the same. Nothing in
a cheap sweep checks that claim, so:

> every cheap tier must be periodically validated against the expensive tier it
> replaces, or you get a green suite over a wrong product.

`npm run eval:correlate` runs each case declared `tier: 1` in **both** lanes and
compares the verdicts. It does not reimplement the runner — it invokes
`run.js --tier 1` and `--tier 2` over the same cases, so grading, cross-checks
and gold execution are literally the sweep's code.

| outcome | meaning |
|---|---|
| `AGREE_PASS` | the only outcome that **establishes** the proxy |
| `FALSE_GREEN` | tier 1 passes what tier 2 fails — the suite certifies behaviour the real agent does not exhibit. The dangerous direction: nobody looks at a green suite |
| `FALSE_RED` | tier 1 fails what tier 2 passes — loud rather than silent, but still a broken proxy. Move the case back to tier 2 |
| `AGREE_FAIL_SAME` / `_DIFFERENT` | both lanes failed. Consistent at best; a red case proves nothing about the proxy, and the same verdict for *different* reasons is not agreement at all |
| `INCOMPLETE` | a lane produced no runs — nothing was compared |

Both disagreement directions fail the check. Exit 0 means one thing only: the
proxy is validated. "Both lanes failed" and "could not compare" leave the cheap
lane unproven, and unproven must never read as fine.

Two guards worth knowing about:

- **Provenance outranks the arithmetic.** If the two lanes ran at different
  semantic identities, data sources or models, the verdict is `INVALID` — a
  perfect case-by-case agreement between two *different products* has compared
  nothing.
- **Reasons, not just verdicts.** Every row carries `kind_pass` and the names of
  the cross-checks that fired, so two lanes failing the same case for unrelated
  reasons are reported as inconclusive rather than as evidence.

Running a **tier-2** case cheap (`--case <name>`, or `--all`) is a *probe*: it
asks whether the case could be promoted, and never fails the gate.

The check never stamps `last_validated`. A forced-lane run measures the harness,
not a concept, and it runs each case twice — letting it stamp would put the
cheap lane's word on a governed definition. Its output lands in
`evals/results/correlation/<ts>/` rather than the main results stream, because a
forced-tier sweep sitting beside normal sweeps would be diffed against one by
`eval:report` and every case that changed lane would read as a flip.

It rides the scheduled and manually dispatched CI runs, not PRs: it costs twice
the runs of the cases it covers.

## Running less, and running it in parallel (EVAL-12b)

Both are opt-in. A sweep with neither flag behaves exactly as it did before.

### `--select` — skip what a change could not have moved

Every result row carries a **case fingerprint**: a hash of the inputs that
case's verdict can depend on.

| in the fingerprint | why |
|---|---|
| the case file | question, gold query, cross-checks |
| its `must_use` concepts, plus their `of:` / `subtype_of:` chain | the definitions it routes to. Editing `kp:Customer` can change what `kp:ActiveCustomer`'s membership rule *means* without touching its file |
| the routing **surface** — every `uri\|kind\|status` | a concept appearing, disappearing or becoming approved changes what *any* question can route to, including a question whose right answer is "that is not governed" |
| `kp/agent/examples.md`, `corrections.md` | standing hints the agent acts on (the same reason EVAL-8 keeps them inside the semantic identity) |
| `models/`, `CLAUDE.md`, the runtime | shared by every case, so any edit here selects everything |

`--select` then skips a case when the ledger of past result files already holds
a **clean, complete** measurement at its current fingerprint, in the same lane,
against the same data and the same model: enough passing runs, and **not one**
failing or errored run. "Plus last run's failures" needs no special handling —
a failure is simply never evidence, which also stops a flaky 4-of-5 from being
averaged into a pass.

Why a per-case fingerprint rather than `semantic_identity` (EVAL-6): the
identity covers the whole repo, so editing one concept changes it and every case
would be re-measured for a definition only one of them routes to. This is the
same idea narrowed to one case.

Three refusals, all because a false skip is invisible:

- **A case with no `must_use` is never skipped.** Its concept dependencies are
  undeclared, so nothing can tell whether the definition someone just edited is
  one it routes to. `must_use` is a declaration of dependency, and only a case
  that makes one can be selected out. `refusal-ungoverned` declares none and so
  always runs.
- **`--select` is refused with `--live`.** Live data can move underneath an
  identical fingerprint, and measuring exactly that is what a drift run is for.
- **The routing surface is `uri|kind|status`, not the generated `kp/index.md`.**
  The index is a projection of the concept files, so digesting it whole would
  make every definition edit select every case and the mechanism would do
  nothing at all.

Skipped cases are recorded on a `kind: selection` meta line, never as result
rows — a skipped case must not be readable back as a measurement of itself, or
one sweep's pass would propagate forever through sweeps that never ran it. The
sweep summary says `NOT RE-MEASURED` next to the pass rate, because "6/6
passed" over a selected sweep means "2 measured, 4 assumed". `eval:report`
reads the same line and reports skipped cases as `NOT COMPARED` rather than as
cases that vanished.

Rows written before this existed carry no fingerprint and are ignored, so the
first sweep after adopting `--select` selects everything. A wiring bug that
stopped the fingerprint being written would have the same effect — the feature
would quietly do nothing, which is the safe direction for it to fail in.

### `--concurrency <n>` — fan out, but warm first

Runs are independent samples and the grader shares no state, so parallelism is
a straight wall-clock win. Measured 2026-07-31 on a 5-case × 3-run sweep at
`--concurrency 4`: **10.2 min against 24.9 min of summed run latency (2.4x),
$8.72** — against $9.66 / 24.7 min for the comparable serial sweep, so it is
roughly cost-neutral.

Three details are not optional:

- **The first job runs alone.** Prompt caching (EVAL-12c) is content-keyed: the
  tier-1 prompt caches as a ~5.7k block every case shares plus a ~10k block per
  case. The first call creates the shared one; start N workers cold and all N
  write their own copy of it.
- **A case's later runs wait for that case's first run.** They are
  byte-identical prompts, so the leader's write is what makes them free. This
  rule was missing on the first live run and it cost a duplicated 10,191-token
  creation: `refusal-routing-decision` runs 1 and 2 started together and both
  paid for the same block. Leaders of *different* cases still overlap — their
  per-case blocks genuinely differ, so that creation is not waste.
- **Malloy queries stay serialised.** Grading queries are milliseconds against
  the agent's minutes, so queueing them costs no wall clock and removes
  concurrency as a possible explanation for a verdict.

The `Prompt cache:` line in the sweep summary is the sensor for the first two,
but read it carefully — **it is only meaningful over tier-1 rows**. A tier-2
session re-reads its own growing context on every turn and always has something
new to write, so a tier-2-heavy sweep posts a flattering headline (92% on
2026-07-31, with every tier-2 run writing cache) that says nothing about
cross-run warming. Read it on a sweep that starts **cold**, too: a re-run inside
the cache TTL reads cheaply whether or not the scheduling is right.

Impact selection has the cache interaction in reverse: a PR that runs 2 cases
instead of 30 pays the cold start over a much smaller sweep, so the per-run cost
of a *selected* run is closer to $0.16 than $0.03.

## Anchored ground truth (EVAL-2)

Numeric gold values rot when data moves. Two defences, both in use:

1. **Fixtures freeze the numbers.** The parquet files under `ParquetFiles/` are
   committed to git, so CI checks out byte-identical data on every run. They
   already are the hermetic fixture set — there is deliberately no second
   sampled copy to keep in sync, and no "fixture vs live" gold discrepancy.
2. **Query grading grades the method.** For `query_shape`, the agent's executed
   Malloy and the `gold_query` are both run against the same data and their
   result sets compared. This proves equivalence without brittle string
   matching, and it survives data changes because both sides move together.

### Match tiers (EVAL-9)

The comparison returns the strongest tier that holds, and the tier is recorded
in `grade_detail` so a reviewer can disagree with a weak pass:

| tier | means |
|---|---|
| `exact` | same columns, same rows |
| `values` | same rows, columns renamed — the agent may alias its output freely |
| `subset` | the gold table is present, plus extra **columns** the agent chose to return (the denominator next to the count) |
| `none` | no match |

`subset` is column-and-row aware. Extra **rows** are not containment: a
different row count is a different grain or a missing filter, which is a
different answer. The first implementation compared flattened value multisets,
so a gold scalar of `31576` passed against any result that happened to contain
a `31576` anywhere — including one with fifty extra rows.

Leftover column names are *searched*, not guessed: columns pair by name where
the names agree, and if some assignment of the agent's remaining columns
reproduces the gold table exactly, the gold table is present. A same-named
column that disagrees is never re-mapped to some other column that agrees. The
search is bounded (≤3 unmapped gold columns, ≤8 spare agent columns) so a wide
result set cannot turn a comparison into a factorial.

A case may set `min_match: subset | values | exact` (default `subset`) to refuse
the weaker tiers where column names or exact shape are part of what is being
tested.

Result-set comparison is order-insensitive and reports one of:

| verdict | meaning |
|---|---|
| `exact` | same keys and same values |
| `values` | same numbers, different column names — the agent may alias freely |
| `subset` | every blessed number is present, alongside extra context the agent chose to return (a denominator next to a count, say) |
| `none` | fail |

The first three pass, and which one is recorded in the result row so a reviewer
can disagree with a `subset`. The tier exists because agents legitimately return
more than they were asked for: an otherwise perfect active-customer answer that
also reports the total customer base is not a method failure, but a whole-result
diff scores it as one.

**A live example of why this matters.** `kp:ActiveCustomer`'s bound measure
compiles to a window anchored on `LOCALTIMESTAMP`, so the active-customer count
changes on a calendar boundary with no data and no definition change. A pinned
`expect_value` there would report a regression that never happened, so
`membership-verbatim` is graded as `query_shape` instead.

## Results and telemetry (EVAL-3)

One JSONL row per (case × run) in `evals/results/<UTC-timestamp>.jsonl`, plus a
leading `run_meta` line carrying model, quorum, data source and semantic
identity. Rows record the verdict and the reason, the answer excerpt, the Malloy
that actually ran, extracted vs expected value, tokens, cost, latency, turn
count and whether a provenance receipt was present.

Regressions become a query, and since SIMP-2 that is literal: the grouping lives
in `evals/results.malloy`, a Malloy source over `read_json_auto` of the whole
results tree, and `report.js` is a printer. `npm run eval:report` prints the
latest sweep with its provenance, pass rate by case and by category, the flaky
cases, and any case whose verdict flipped between its own last two sweeps
(exit 1 on a regression). `--view <name>` prints any other view in the model
(`by_lane`, `cost_by_case`, `sweeps`, `provenance`, `flips`) as JSON.

The point of the move is that the eval history is now *askable*. Questions like
"what did each lane cost" or "which sweeps ran at a different semantic identity"
are views instead of throwaway scripts, and the agent analyses its own eval
history with the exact tool under test.

Two things to know before writing a view:

- **`case` is a reserved word in Malloy**, so the SQL layer renames it to
  `case_name` once. `filename=true` is what gives each row its sweep.
- **Rate views filter to `stream = 'sweep'`.** The glob reads every stream —
  sweeps, correlation, selftest, stripped-protocol — because that history is
  worth having, but a stripped-protocol run is *supposed* to fail and a
  forced-tier correlation run measures the harness. Averaging them into a pass
  rate reports two experiments as one number. Descriptive views (`sweeps`,
  `provenance`) deliberately span everything.

Note: flips read from the committed results tree, so a CI run starting from a
fresh checkout sees only the sweeps that are in the repo — cross-run flip
detection needs the results committed or the previous artifact downloaded.

### Stochasticity

The thing under test is a model. One green run proves little and one red run is
as likely to be noise as a regression, so each case runs N=3 times and passes
only on a quorum (default: all of them). Every individual run is recorded, and
the report lists cases that passed 2 of 3 — a flaky case is visibly flaky rather
than silently alternating colour between builds.

### When the agent never answers

The CLI returns an API failure in the same envelope as a successful reply — the
error text lands where the answer would be — so `API Error: 529 Overloaded`
reaches the grader as an answer that routed to no concepts and ran no Malloy,
and scores as a confident product failure. The correlation check's first real
run was invalidated this way: three of six tier-1 calls got a 529 and the check
reported a lane disagreement that was entirely the API's.

So a transport failure is classified, not graded:

- A run whose reply *begins* with an API/network error is a **transport error**,
  and is retried up to 3 attempts (429 and 5xx only — a 401 will not fix
  itself). `attempts` is recorded on the row, so a flaky API stays visible
  rather than being silently absorbed.
- If the retries are exhausted the row is marked `errored: true` and is **not a
  verdict**: it is excluded from the quorum instead of counted as a failure.
- A case with any errored run does **not pass**. Fewer completed runs than the
  quorum means there is no quorum — scoring the survivors would let one lane's
  bad luck read as a smaller sample quietly satisfying the same bar.

A reply that fails to *parse*, or a run that hits the turn cap, is behaviour and
stays a genuine failure. The distinction is whether the agent answered at all.

## Semantic identity (EVAL-6)

Every result row carries a hash of the meaning the number was produced under:

```
sha256( digest(kp/) + digest(models/) + digest(CLAUDE.md) + malloy/duckdb/dialect )
```

- same identity, different number → **the data moved** (expected on `--live`)
- different identity → **the meaning moved**: a `kp/`, `models/` or `CLAUDE.md`
  edit. Drift becomes explained rather than mysterious, and `eval:report` says
  which of the two it was.

`CLAUDE.md` is in the hash because it is the routing protocol: a change there
can move every number without touching a single concept file.

The digest is over the **working tree**, not `git rev-parse HEAD:kp`. Evals are
most valuable on uncommitted edits — that is exactly when someone is changing a
definition and wants to know what it breaks — and a committed-tree hash would
describe code that is not the code under test. Git tree shas are recorded
alongside, with a `dirty` flag when the two disagree.

### What is NOT meaning (EVAL-8)

The runner writes back into the very tree it digests, so three things are
excluded or normalised away before hashing — otherwise every successful sweep
would change the identity and the next report would announce "the meaning
moved" when only a date moved, which is the exact false signal this hash exists
to prevent:

- **`last_validated:` lines** are stripped from text files. The stamp is
  evidence that a definition was checked, not part of what it says.
- **`kp/agent/gap-log.md`** and **`kp/agent/question-log.md`** are excluded
  entirely. Recording that something is *ungoverned*, or that a question was
  asked, changes no governed definition — and both grow on ordinary use.
- The `dirty` flag ignores the same files, and ignores a concept file whose only
  diff from HEAD is its `last_validated` stamp. A flag that reports drift the
  hash deliberately ignores is just a second false signal.

`kp/agent/examples.md` and `kp/agent/corrections.md` stay **in**. Those are
standing hints the agent reads and acts on: editing them can move a number,
which is what "the meaning changed" means. Binary fixtures (`ParquetFiles/`)
are always hashed byte-for-byte — no text normalisation is applied to them.

## Gold values

Computed, never typed. `npm run eval:gold` runs each `gold_query` against the
fixtures and writes the scalar into `expect_value`, so the number and the query
that produced it stay together and regenerable. It also *executes* the gold
query of every non-numeric case: a gold query that no longer compiles is a
broken case, and it is much cheaper to learn that here than to watch a sweep of
agent runs fail for a reason that has nothing to do with the agent.

`npm run eval:check` is the read-only form for CI — it verifies every case
parses, every gold query runs, and no committed value has drifted, without
invoking an agent.

If a numeric case has no `expect_value` yet, the runner computes one in memory
so the loop still works, and records `gold_source: computed-at-runtime` so an
unaudited number is never mistaken for a blessed one.

## `last_validated` stamping

`ARCHITECTURE.md` documents `last_validated` as eval-runner-stamped; the runner
is the writer. When a case passes, every concept in its `must_use` gets today's
date. The field means "a governed answer through this concept was verified on
this date", not "somebody looked at it".

Stamping is skipped automatically when `CI` is set, and can be disabled with
`--no-stamp`. It is also suppressed unconditionally under `--live`, including
when `--stamp` is passed explicitly: the field claims a governed answer was
verified against the **committed fixtures**, and a live run measures drift
against data nobody has pinned. Frontmatter is edited surgically (one field, regex on the
frontmatter block) rather than round-tripped through a YAML serialiser, which
would reformat quoting and key order across the bundle and trip the OPS-1
dirty-tree gate for reasons unrelated to the change.

## Side effects

The agent under test runs with read + Malloy-execution tools only. A sweep is
N × M agent runs; if it could write, it would append to `question-log.md` a few
dozen times per sweep and dirty the tree the build gates on. Log-append *intent*
is still visible in the trace as a denied tool call.

The prompt is delivered over stdin, never argv — `claude` is a `.cmd` shim on
Windows, which forces `shell: true`, and a shell concatenates argv rather than
escaping it. Passing the question as an argument silently truncated it to its
first word.

## Does the harness work? (`eval:selftest`)

A suite that passes everything is indistinguishable from a suite that grades
nothing. The selftest takes the two regressions seen in real sessions
(`no-rederivation-margin`, `financial-situation-projection`), runs them against
a deliberately stripped protocol — a competent but ungoverned analyst prompt,
not a strawman — and requires them to **fail**; then runs them against the real
protocol and requires them to **pass**. Only a harness that does both is worth
gating a PR on.

The control prompt is a reviewable file, `evals/protocols/stripped-analyst.md`,
with the rule for editing it written inside: it may say anything a sensible
analyst prompt would say about querying Malloy, and it may not mention concepts,
bindings, the routing table, governed metrics, membership rules, tiers or
receipts. Everything the selftest exists to detect must be absent there and
present in `CLAUDE.md`.

### `run.js --protocol <path>` (SIMP-5)

The mechanics live in the runner, not in the selftest. `--protocol` swaps the
file in for the duration of the run and restores it afterwards — in a `finally`,
on SIGINT/SIGTERM/SIGHUP, and on any crash.

**Why a swap rather than injection.** Both lanes *discover* `CLAUDE.md` from the
working directory; tier 1 does it exactly as tier 2 does, because "tier 1
differs from tier 2 in tools and turns and nothing else" is what makes the
correlation check a comparison rather than two unrelated measurements. Injecting
into one lane and discovering in the other would break that, and injection also
means `claude --bare`, which forces API-key-only auth and breaks a local run on
OAuth.

Three properties it has to hold, each because of a specific way it could lie:

- **The swap happens before the identity is computed.** `CLAUDE.md` is inside
  `semantic_identity` and inside every `case_fingerprint`, so hashing before the
  swap would stamp a stripped-protocol run with the shipped protocol's identity
  — and `--select` would then be entitled to skip a real case on the strength of
  a run that deliberately used the wrong rules. The runner *asserts* the
  identity it computed matches the protocol file, so a future reordering fails
  loudly instead.
- **Results land in `evals/results/protocol/`** and never stamp `last_validated`
  — same reasoning as the correlation check. A run under a scratch protocol
  sitting beside normal sweeps would be diffed against one by `eval:report`, and
  every case would read as a flip.
- **Exit codes distinguish a verdict from no verdict**: `0` all passed, `1` a
  case failed, `2` nothing ran. That third code is load-bearing for the
  selftest, whose stripped phase *expects* failure — a run that never happened
  (dirty `CLAUDE.md`, a leftover backup, a missing protocol file) arriving as
  the same code would deliver exactly the answer that phase hopes for, and the
  selftest would certify a harness it never exercised.

The run refuses to start if `CLAUDE.md` has uncommitted changes, or if a
backup is left over from an interrupted run — that file is somebody's real
protocol, and writing a new backup over it destroys the only copy.

**The backup lives outside the repo (EVAL-15), not at
`<repo-root>/CLAUDE.md.protocol-backup`.** It used to sit there, inside the
working tree the agent under test explores with `Read`/`Glob` during the
stripped-protocol phase — so an agent that looked found the real protocol one
tool call away and could follow it instead of the scratch prompt it was meant
to be limited to (confirmed live in a 2026-08-06 harvest run). `swapIn`/`guard`
now default `backupFile` to a path under the OS temp directory, keyed by a
hash of the protocol file's own resolved path (`protocol.js`'s
`defaultBackupFile`) — stable across runs of the same repo, so the
leftover-backup guard above still finds a crashed run's backup, but not
sitting anywhere an agent exploring the repo would think to look.

## CI

`.github/workflows/eval.yml`, deliberately separate from the build gate:

- **The deterministic checks are in `npm run build`** (SIMP-4), which already
  blocks the PR: every case parses, every gold query runs, no committed gold
  value has drifted. They are validation, and validation belongs in the build
  rather than in a second gate someone has to remember. `eval.yml` keeps them
  as a pre-flight step, which costs seconds and stops a broken case from
  spending a whole sweep.
- **`eval` job — report-only.** The agent sweep, with `continue-on-error`.
  Promote it to blocking by deleting that one line, once the pass rate is green
  and stable. A stochastic suite that blocks merges on day one gets switched off
  within a week.
- **PRs run `--select`; pushes, schedules and manual dispatches do not.**
  Something has to keep re-measuring the cases a PR was allowed to skip, and a
  fingerprint is only as good as the sweep that last confirmed it. A fresh
  checkout has no ledger, so a best-effort step downloads the results artifact
  of the last successful run on `main` first; if that fails, `--select`
  degrades to a full sweep.
- **The correlation check** runs in the same job on schedule and manual
  dispatch only. Promote it to blocking together with the sweep.

Scheduled Monday drift runs use the same cases against live data.

## Growing the suite

Harvest, don't invent (EVAL-5). In priority order: the known regressions; then
`kp/agent/question-log.md`, where each novel analysis is a candidate; then
`kp/agent/corrections.md`, where each confirmed wrong answer becomes a
regression case with the corrected result as gold. Target ~30 cases with
refusal and tier-boundary over-represented, since those catch the worst
failures. Establish the loop: every correction filed gets an eval case in the
same PR.

### Auditing a case: is it testing the protocol at all?

`npm run eval:selftest -- --all` runs every case through both phases. The
default stays the two known regressions, because that is the cheap gate; `--all`
is the periodic audit, and it is the only mechanism here that answers the
question empirically.

It has to be periodic, because **reading a case cannot tell you** — a hollow one
looks exactly like a thorough one. Two of the six were found hollow this way:

| case | looked like | actually satisfied by |
|---|---|---|
| `financial-situation-projection` | 5 `must_use` concepts | compile output, which echoes `#(kp) concept` annotations from `models/` |
| `aov-synonym` | `must_use` + `must_not_contain` + gold query shape | the routing table, which the **tier-1 prompt injects** |

Both were fixed by asserting the one thing an ungoverned agent reliably fails to
produce: the AGT-1 receipt. That generalises — **prefer `expect_receipt: true`
on any case that returns a figure**, because the receipt depends on a rule that
lives only in `CLAUDE.md`, whereas routing can be supplied by the models or by
the harness.

One case is exempt, by name and with its reason printed on every run:
`refusal-routing-decision`'s entire right answer is "CLV is absent from the
routing table", and the harness injects that table — so the answer is readable
off the prompt under any protocol, and it returns no figure, hence no receipt to
assert. Exemptions are listed in `selftest.js` rather than inferred from a tier,
so they stay reviewable; naming a case that no longer exists is a hard error.

**When the selftest reports BAD, fix the case, not the control.** Weakening the
stripped prompt to make a case fail proves nothing. See
`evals/protocols/README.md`.

### Two rules learned the hard way (2026-08-03)

**1. Audit every new case before counting it as coverage.** Run
`npm run eval:selftest -- --case <name>`. Two of the six existing cases were
found testing nothing while looking thorough; reading a case cannot tell you,
because a hollow one looks exactly like a good one.

**2. Author assertions from recorded runs, not from imagination.** The result
files under `evals/results/` are a corpus of real answers to the same questions,
and mining them costs nothing. `standing-hint-window` chose its
`expect_contains` phrase by scoring candidates against 10 recorded runs of its
question:

| candidate | in correct (7) | in incorrect (3) |
|---|---|---|
| `wall clock` | 7 | 0 |
| `LOCALTIMESTAMP` | 6 | 0 |
| `2024-04-20` | 7 | 2 |
| `last 2 years`, `window` | 7 | 3 |

The obvious choice — the data-coverage date — would have been wrong: the two
incorrect answers quote `2024-04-20` while stating the window is anchored to it
"not today", which is the exact inversion of the defect under test. Guessing
would have shipped a case that passes an answer saying the opposite of the
truth.
