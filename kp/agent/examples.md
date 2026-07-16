---
type: examples
title: Canonical query patterns
description: Copy these shapes; adapt bindings from the routing table.
---

# Canonical query patterns

Simple governed aggregate:
```malloy
run: sales_order -> { aggregate: total_sales }
```

Grouped, filtered, limited:
```malloy
run: sales_order -> {
  group_by: customer.Occupation
  aggregate: total_sales, order_count
  where: order_date.year = @2023
  limit: 10
}
```

Defined class — ALWAYS via the bound measure, never a hand-written filter:
```malloy
run: customer_order_in_context -> { aggregate: active_customer_count }
```

Time series anchored to data coverage (see routing table), not today:
```malloy
run: sales_order -> {
  group_by: order_month is order_date.month
  aggregate: total_sales
  where: order_date >= @2022 & order_date < @2024
}
```

Exploratory: YoY growth over a governed measure (tier 2 — full freedom):
```malloy
run: sales_order -> {
  group_by: yr is order_date.year
  aggregate: total_sales
  calculate: yoy_growth is (total_sales - lag(total_sales)) / lag(total_sales)
  order_by: yr
}
```

Exploratory: share of total (use all(), not parent()):
```malloy
run: sales_order -> {
  group_by: store.CountryCode
  aggregate: total_sales, pct is total_sales / all(total_sales)
  order_by: total_sales desc
}
```

Exploratory: naive projection basis (partial year vs same period last year —
present as "projection from governed TotalSales", not as an official number):
```malloy
run: sales_order -> {
  where: order_date.month <= @2024-04
  group_by: yr is order_date.year
  aggregate: total_sales
}
```

Cross-domain via in-context source (never invent a join):
```malloy
run: order_line_in_context -> {
  group_by: product.BrandName
  aggregate: line_revenue_sum
}
```
