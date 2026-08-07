---
type: eval
title: Governed measure sliced by an ungoverned name-match filter (bike contamination)
category: tier-boundary
question: "Do we sell anything like bikes, and if yes who are our top 5 clients?"
expect_kind: query_shape
min_match: values
gold_query: |
  run: sales_order -> {
    where: lower(lines.sold_product.ProductName) ~ '%bike%'
    group_by: placed_by.CustomerKey, placed_by.GivenName, placed_by.Surname
    aggregate: bike_revenue is lines.line_revenue.sum()
    order_by: bike_revenue desc
    limit: 5
  }
must_use: kp:LineRevenue, kp:Customer
must_not_contain: ["~ '%ike%'", "ProductName ~ '%ike%'", "lower(ProductName) ~ '%ike%'"]
expect_receipt: true
---

Harvested from `kp/agent/corrections.md` (2026-08-04 correction — EVAL-5:
corrections become cases).

**The observed failure.** The agent filtered on `ProductName ~ '%ike%'`,
which matches "A. Datum SLR-**like** Digital Camera M400" in seven colours as
readily as it matches the three `Contoso Battery charger - bike E200`
products. 96% of the reported "bike revenue" was cameras, and every one of
the five reported customer names was wrong as a result.

**The correct filter** is `lower(ProductName) ~ '%bike%'` (case-insensitive,
no truncated stem). `gold_query` reproduces the corrected figures exactly:
Spencer Spencer $548.69, Abbie Fitzgerald $547.21, Scott Sheppard $523.37,
Mariano Padovesi $520.39, Harvey Barnes $506.12.

**Why `query_shape`, not `analysis`.** The defect is mechanical — a specific
wrong pattern producing a specific wrong result set — so comparing result
sets catches it directly: the contaminated pattern returns a completely
disjoint set of customers and larger figures (cameras dominate), which fails
`gold_query` comparison outright. `min_match: values` (not the default
`subset`) because the row identity is the whole point here — an agent
returning extra context columns is fine, but returning the wrong five
customers is not.

**Why `must_not_contain` names the exact buggy pattern.** This is the
regression itself, not a general principle — the general principle (governed
measure, ungoverned name-match slice, must disclose and verify matches) is
tested by `expect_receipt` and by `query_shape` catching a wrong result. The
literal pattern guard is cheap insurance against the exact bug recurring.

`kp:LineRevenue`, not `kp:TotalSales`: the correct method sums the governed
line-level measure over the *filtered* (bike-only) lines — `kp:TotalSales` is
bound at the unfiltered order grain and would overcount every order that also
contains non-bike lines. Reaching for the line-grain governed measure instead
of hand-deriving `Quantity * NetPrice` is itself part of what's under test.

**Tier.** 3, not 2 — "bikes" is not `kp:ProductCategory` (8 values, none of
them bike), so this is a governed measure cut by an ungoverned classification,
same rule as any other governed-measure-under-ungoverned-slice case.
