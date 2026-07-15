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

Grouped, filtered, limited (join aliases are `placed_by`/`placed_at`/`occurs_on`/`lines`, not the bare source name; the order date is `DT`, inherited directly onto `sales_order`):
```malloy
run: sales_order -> {
  group_by: placed_by.Occupation
  aggregate: total_sales, order_count
  where: DT.year = @2023
  limit: 10
}
```

Defined class — ALWAYS via the bound measure, never a hand-written filter. `is_active_customer` is a customer-grain boolean measure, so a single-stage `aggregate:` collapses it to one boolean over ALL customers — pipeline through a per-customer stage first to get a real count:
```malloy
run: customer_order_in_context -> {
  group_by: CustomerKey
  aggregate: is_active_customer
} -> {
  aggregate: active_customer_count is count() { where: is_active_customer }
}
```

Time series anchored to data coverage (see routing table), not today:
```malloy
run: sales_order -> {
  group_by: order_month is DT.month
  aggregate: total_sales
  where: DT >= @2022 & DT < @2024
}
```

Cross-domain via in-context source (never invent a join). Join alias for product is `sold_product`; `line_revenue` is a dimension, so sum it explicitly:
```malloy
run: order_line_in_context -> {
  group_by: sold_product.Brand
  aggregate: line_revenue_sum is line_revenue.sum()
}
```
