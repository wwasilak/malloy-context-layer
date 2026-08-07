---
type: eval
title: Returns — ungoverned AND absent from the data entirely
category: refusal
question: "What percentage of our orders resulted in a return, and what are the top return reasons?"
expect_kind: refusal
max_malloy_calls: 1
---

Harvested from `kp/agent/gap-log.md` (2026-08-05).

Not governed (no `kp:Return`/`kp:ReturnReason` concept) **and not present in
the underlying data at all** — no returns table, no return-reason field, no
proxy (e.g. negative quantity) anywhere in `ParquetFiles/` or `models/`.

Correct behavior: absence from the routing table is conclusive that it isn't
governed (no Malloy call needed for that part); one look at the compiled
schema of the plausible source(s) (`order`/`order_line`) settles that no
exploratory figure is possible either, and the agent should say so and stop.
`max_malloy_calls: 1` — not `0`, unlike `refusal-routing-decision` — because
CLAUDE.md's one-look rule explicitly sanctions exactly one schema check
before concluding no proxy exists; budgeting `0` here would fail correct
behavior instead of catching waste.

Failure: presenting a computed number as returns (there is no field this
could honestly come from), or repeatedly compiling/describing more sources
hoping to find one — no amount of searching can produce a field that is not
there, so anything past one look is protocol waste, the same lesson
`refusal-ungoverned`/`refusal-routing-decision` established for governance
absence, applied here to *data* absence.
