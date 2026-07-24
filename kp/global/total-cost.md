---
uri: kp:TotalCost
type: measure
title: "Total Cost"
description: "Sum of line cost across all order lines in scope."
tags: [global, approved]
status: approved
timestamp: 2026-07-15
---

# Total Cost

Sum of line cost across all order lines in scope.

## Implementations

<!-- BEGIN GENERATED: implementations (written by exporter; do not edit) -->
| Model | Source | Field |
|---|---|---|
| base | `sales_order` | `total_cost` |
| finance | `finance_order` | `cost_of_goods_sold` |

Measured on [Order](../sales/order.md).
<!-- END GENERATED -->
