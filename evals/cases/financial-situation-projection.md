---
type: eval
title: Financial situation summary + naive YoY projection
category: projection
question: "What was my financial situation in 2023, and how would 2024 look based on sales?"
expect_kind: analysis
gold_query: |
  run: finance_order -> {
    aggregate: order_count, gross_revenue, discount_amount, discount_rate,
      total_sales, total_cost, margin, margin_percent, markup_percent,
      average_selling_price, average_exchange_rate
    where: DT.year = @2023
  }
  run: sales_order -> {
    group_by: yr is DT.year
    aggregate: total_sales, order_count
    where: (DT >= @2023-01-01 and DT < @2023-04-21) or (DT >= @2024-01-01 and DT < @2024-04-21)
    order_by: yr
  }
must_use: kp:TotalSales, kp:Margin, kp:MarginPercent, kp:GrossRevenue, kp:OrderCount
# SIMP-5: added after the first live selftest, which caught this case passing
# against a deliberately UNGOVERNED protocol. See the note below — `must_use`
# alone could not tell the two apart.
expect_receipt: true
---

Tests tier-2 analysis freedom on top of governed bindings: 2023 figures pulled
straight from `finance_order` (gross revenue, discount, margin, markup) and
`sales_order` (trend), then a tier-2 projection layered on top.

## Why `expect_receipt` is here

This case used to carry `must_use` and nothing else, and the first live run of
the rebuilt selftest (2026-07-31) found that it passed **without the governance
protocol at all** — an ungoverned analyst prompt satisfied it while producing no
receipt and never reading the Knowledge Plane.

The mechanism: `must_use` searches the whole trace *including what came back
from tools*, and every URI above appears in `models/*.malloy` as a `# concept`
annotation. The agent compiled three models to inspect their schemas, the
compile output echoed all five URIs into the trace, and the check was satisfied
by the model files rather than by anything the agent decided. Since SIMP-4 made
"approved but unbuilt" a hard build failure, *every* approved concept is
annotated somewhere in `models/`, so this is general rather than a quirk of this
case: **at tier 2, `must_use` on its own is not evidence of routing.**

`expect_receipt` is the check that discriminates, and it is the same one that
made `no-rederivation-margin` fail correctly in the same run. The AGT-1 footer
is required by CLAUDE.md and an ungoverned prompt has no reason to emit one.

Two things must go right:

1. **Data coverage check.** Routing table says coverage ends 2024-04-20. A
   naive full-2023-vs-partial-2024 comparison silently overstates the
   decline. Correct approach: restrict both years to the same Jan 1–Apr 20
   window before computing YoY growth, then scale FY2023's full-year total
   by that growth rate. Failure: comparing partial 2024 directly against
   full-year 2023 totals.
2. **Framing.** The projection must be presented as "naive YoY extrapolation
   of TotalSales" (or similar), not as an official governed figure, and the
   answer should note it inherits governance from kp:TotalSales per the
   tier-2 rule in CLAUDE.md. Recurring form of this question is a promotion
   candidate for a governed "same-period YoY" view.

Should also produce a `question-log.md` entry (tier 2) — routine single-metric
lookups don't get logged, but a novel projection does.
