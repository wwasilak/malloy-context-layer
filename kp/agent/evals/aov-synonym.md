---
type: eval
title: AOV synonym resolution
category: synonym
question: "What was the AOV in 2023?"
expect_kind: query_shape
# EVAL-12a: A synonym resolves to a binding on turn one; nothing here needs a second turn.
tier: 1
gold_query: "run: sales_performance -> { aggregate: average_order_value; where: DT.year = @2023 }"
must_use: kp:AverageOrderValue
must_not_contain: ["total_sales/order_count", "total_sales / order_count"]
# SIMP-5 audit (2026-08-03): without this the case passed against a
# deliberately UNGOVERNED protocol — see the note at the end.
expect_receipt: true
---
Tests that "AOV" routes to kp:AverageOrderValue via synonyms, not an improvised sum/count.

Gold query follows the binding in the routing table
(`sales.sales_performance.average_order_value`) and the temporal anchor
(`base.order.DT` = kp:OrderDate).

Graded on METHOD, not on the number in the prose (EVAL-11). This case was
`numeric` and passed on the luck of answer ordering: the figure was extracted
via `currency` twice and `bold` once across three identical questions, and the
first answer to lead with a different figure would have broken it. The fix is
not a better regex — it is to stop parsing prose for a number the executed
query already states exactly. 2023 is a closed historical window, so either
grading survives data movement; the fragility here was extraction, not rot.

All three observed runs executed the bound measure alongside two context
columns (`total_sales`, `order_count`), which scores `subset` — the tier that
exists for exactly this. Note the case now also asserts the SHAPE: answering
"AOV in 2023" by computing AOV for every year and reading the 2023 row off
scores `none`. The question names the window, so filtering to it is the
expected method.

`must_not_contain` guards the tier-3 failure specific to this concept:
re-deriving AOV as total_sales / order_count instead of using the bound
measure. Both agree today; they diverge the day the definition changes.

## Why `expect_receipt` is here (SIMP-5 audit, 2026-08-03)

The full selftest ran every case against a deliberately ungoverned analyst
protocol, and this case **passed** — it was not testing the Knowledge Plane.

The reason is specific to tier 1: the harness injects the routing table into the
prompt, so "resolve AOV to `kp:AverageOrderValue` and query its binding" is
answerable from the table the harness handed over, with or without CLAUDE.md.
`must_use`, `must_not_contain` and the gold query shape were all satisfied that
way.

What the stripped protocol *did* cost the agent was the **receipt**: this case
recorded `receipt_present: true` under the real protocol and `false` under the
stripped one, on the same question. So CLAUDE.md is demonstrably still doing
work at tier 1 — the case simply was not asserting the part that depends on it.

Asserting it costs nothing (the shipped run already produces one) and makes the
case discriminate at tier 1, which is worth having: `refusal-routing-decision`
is exempt from the selftest precisely because it has no such lever.
