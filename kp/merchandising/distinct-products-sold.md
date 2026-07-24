---
uri: kp:DistinctProductsSold
type: measure
title: "Distinct Products Sold"
description: "Number of distinct products that appear on at least one order line in scope."
steward: Merchandising
tags: [Merchandising, approved]
status: approved
approved_by: Merchandising
timestamp: 2026-07-15
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
