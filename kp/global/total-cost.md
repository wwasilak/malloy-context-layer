---
uri: kp:TotalCost
type: measure
title: "Total Cost"
description: "Sum of line cost across all order lines in scope."
tags: [global]
status: stable
generated: { by: human:global, at: 2026-07-15T00:00:00Z }
verified: { by: human:global, at: 2026-07-15T00:00:00Z }
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
