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

Cross-domain via in-context source (never invent a join):
```malloy
run: order_line_in_context -> {
  group_by: product.BrandName
  aggregate: line_revenue_sum
}
```
