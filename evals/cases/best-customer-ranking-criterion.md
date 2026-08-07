---
type: eval
title: Ranking by a superlative is an ungoverned slice (tier 3)
category: tier-boundary
question: "Who is our best customer this month?"
expect_kind: contains
expect_contains: ["UNGOVERNED"]
must_use: kp:TotalSales, kp:Customer
expect_receipt: true
gold_query: |
  run: sales_order -> {
    where: DT.month = @2024-04
    group_by: placed_by.CustomerKey, placed_by.GivenName, placed_by.Surname
    aggregate: total_sales
    order_by: total_sales desc
    limit: 5
  }
---

Harvested from `kp/agent/corrections.md` (2026-08-05 correction — EVAL-5:
corrections become cases).

**The observed failure was not a wrong number.** Time anchoring (April 2024,
partial), the top-5-not-top-1 judgement, and treating customer name fields as
labels rather than a classification were all correct and unprompted. The
figures matched `gold_query` exactly. What was wrong: the case was tiered 2
and the receipt read `Basis: ranking of kp:TotalSales (governed) grouped by
kp:Customer (governed)` — no `UNGOVERNED` marker anywhere.

**Why this is tier 3.** Governance applies to the slice as well as the
measure, and a *ranking criterion* is a slice: nobody has ruled that "best"
means highest total spend. Ranking the same customers by `kp:Margin` or
`kp:OrderCount` would each name a different customer. `kp:TotalSales` is
governed; "best" is not — so a clean measure under an ungoverned ranking
criterion is tier 3, exactly like a clean measure under an ungoverned `where:`
filter (see `bike-name-match-contamination`).

**Why `expect_kind: contains` on `"UNGOVERNED"`, not `query_shape`.** The
query and the numbers were already right in the observed failure — the
defect was entirely in the tier/receipt bookkeeping. `query_shape` cannot
grade a receipt's wording, so this case asserts the one thing the failure
actually was: CLAUDE.md's own worked example
(`Basis: kp:TotalSales (governed), segmented by an UNGOVERNED name filter
'…'`) uses the literal capitalised word, and that word is what a reader of
the receipt relies on to see where governance stops without reading the
prose. `must_use` + `expect_receipt` keep the case grounded in an answer that
actually reaches the right concepts and emits a footer at all, not just any
reply containing the word "UNGOVERNED" out of context.

`gold_query` is kept as the audited reference (and is still executed by
`eval:gold`/`eval:check`), even though this case grades disclosure, not
method.
