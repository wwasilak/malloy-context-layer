# The eval loop

The build proves the plane is internally consistent: frontmatter validates, URIs
are unique, every `# concept` annotation resolves, every `preferred_source`
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

npm run eval:gold                 # (re)compute expect_value from each gold_query
npm run eval:check                # verify cases parse + gold has not drifted (no agent)
npm run eval:report               # pass rate by category + flips vs the previous run
npm run eval:selftest             # does the harness detect what it is for?
```

Requires the `claude` CLI on PATH (override with `EVAL_AGENT_BIN`) and the
Malloy MCP server the agent uses to run queries.

## Writing a case

Cases are markdown with YAML frontmatter in `kp/agent/evals/`. `type: eval`
makes them operational docs, so `okf-lib` skips them in the concept registry.
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

An `analysis` case with none of the three cross-checks set is **a load-time
error** (EVAL-10): with no gold artifact and nothing to cross-check, it would
pass unconditionally, forever, while looking like coverage. A test that cannot
fail is worse than no test — it reports confidence it never earned.

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
| `must_use` | the **whole trace** — prose, every tool call, and what came back from tools | reaching for a concept counts however it shows up; a concept can be used in a query without being named in the answer |
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

Regressions become a query, which is the point. `npm run eval:report` diffs the
two most recent runs and prints per-category pass rate, pass→fail flips, and the
cases that passed some runs but not all.

Note: a CI run starts from a fresh checkout and so has no previous file to diff
against — cross-run flip detection needs the results committed or the previous
artifact downloaded. Locally the diff works as soon as you have two runs.

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
a deliberately stripped `CLAUDE.md` — a competent but ungoverned analyst prompt,
not a strawman — and requires them to **fail**; then runs them against the real
protocol and requires them to **pass**. Only a harness that does both is worth
gating a PR on.

`CLAUDE.md` is backed up and restored in a `finally` block and on SIGINT, and
the run refuses to start if `CLAUDE.md` has uncommitted changes.

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
