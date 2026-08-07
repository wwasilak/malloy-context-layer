---
type: eval
title: Per-order discount-rate banding (OrderKey-public regression guard)
category: coverage
question: "What discount levels do we offer, and how many orders fall into each band, by year?"
expect_kind: analysis
must_use: kp:DiscountRate, kp:OrderCount
must_not_contain: ["group_by: RowNumber", "count(RowNumber)", "by line, not by order"]
expect_receipt: true
gold_query: |
  run: finance_order -> {
    group_by: OrderKey, yr is DT.year
    aggregate: discount_rate
  } -> {
    group_by: yr
    group_by: band is pick '0-10%' when discount_rate < 0.10
                  pick '10-20%' when discount_rate < 0.20
                  else '20%+'
    aggregate: order_count is count()
    order_by: yr, band
  }
---

Harvested from `kp/agent/question-log.md` (2026-08-05, both the blocked and
the redone entries) and the RESOLVED `OrderKey`-was-internal standing hint in
`corrections.md`.

**What this regression-guards.** Before the steward's fix,
`order`/`sales_order`/`finance_order` marked `OrderKey` (and several sibling
keys) `internal:`, so no query could `group_by: OrderKey` to reach one row
per order — an ORDER-level discount-rate banding was uncomputable, and the
question was answered at line grain instead (counted by line, not by order,
a materially different denominator). The fix made `OrderKey` `public:` again;
this case is what would have caught a regression back to that state.

**The two-stage pipeline is the point.** `discount_rate` is a governed
per-order measure; banding it requires first reducing to one row per order
(`group_by: OrderKey`, `aggregate: discount_rate`), THEN banding that
per-order value and counting orders — a single-stage query bands the
aggregate incorrectly. `gold_query` reconciles against `kp:OrderCount`: 2015
sums to 24,455 + 9,125 = 33,580 orders.

**Why `analysis`, not `query_shape`.** The band boundaries (0-10% / 10-20% /
20%+) are a presentation choice, not a governed definition — a different
banding scheme is equally correct as long as it operates at order grain.
`must_not_contain` guards the specific line-grain workaround this case
exists to prevent recurring.
