---
type: eval
title: Top-5 customers with a nested top-category breakdown
category: computation
question: "Who are our top 5 customers by total spend over the last 12 months, and what are their top product categories?"
expect_kind: analysis
must_use: kp:TotalSales, kp:Customer, kp:ProductCategory
expect_receipt: true
gold_query: |
  run: sales_order -> {
    where: DT >= @2023-04-21 and DT <= @2024-04-20
    group_by: placed_by.CustomerKey, placed_by.GivenName, placed_by.Surname
    aggregate: total_sales
    nest: top_categories is {
      group_by: lines.sold_product.CategoryName
      aggregate: category_sales is lines.line_revenue.sum()
      order_by: category_sales desc
      limit: 3
    }
    order_by: total_sales desc
    limit: 5
  }
---

Harvested from `kp/agent/question-log.md` (2026-08-05, tier 2).

**Time anchoring.** "Last 12 months" is anchored to the data's `max_date`
(2024-04-20), not today — `@2023-04-21 .. @2024-04-20` — per CLAUDE.md's Time
rule, and the answer must say so.

**Method.** Top-N ranking on the governed `kp:TotalSales`, grouped by the
governed `kp:Customer` entity; per-customer breakdown reaches
`kp:ProductCategory` through the `lines.sold_product` join, using the nested
governed line measure (`lines.line_revenue.sum()`), not a hand-rolled
recomputation.

**Why `analysis`.** "Top 5 with their top categories" is served equally well
by a fully nested shape (this case's `gold_query`), a flat customer-by-category
table, or a category subtotal alongside the per-customer total — several
presentations are correct, so cross-checks (route + receipt) grade this
rather than an exact result-set diff.
