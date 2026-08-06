---
uri: kp:DistinctProductsSold
type: measure
title: "Distinct Products Sold"
description: "Number of distinct products that appear on at least one order line in scope."
steward: Merchandising
tags: [Merchandising]
status: stable
generated: { by: human:merchandising, at: 2026-07-15T00:00:00Z }
verified: { by: human:merchandising, at: 2026-07-15T00:00:00Z }
---

# Distinct Products Sold

Number of distinct products that appear on at least one order line in scope.

## Implementations

<!-- BEGIN GENERATED: implementations (written by exporter; do not edit) -->
| Model | Source | Field |
|---|---|---|
| merchandising | `product_line` | `distinct_products_sold` |

Measured on [Order Line](../sales/order-line.md).
<!-- END GENERATED -->
