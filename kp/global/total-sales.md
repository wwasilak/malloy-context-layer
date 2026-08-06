---
uri: kp:TotalSales
type: measure
title: "Total Sales"
description: "Sum of line revenue across all order lines in scope."
tags: [global]
status: stable
generated: { by: human:global, at: 2026-07-15T00:00:00Z }
verified: { by: human:global, at: 2026-07-15T00:00:00Z }
last_validated: 2026-07-28
---

# Total Sales

Sum of line revenue across all order lines in scope.

## Implementations

<!-- BEGIN GENERATED: implementations (written by exporter; do not edit) -->
| Model | Source | Field |
|---|---|---|
| base | `sales_order` | `total_sales` |
| finance | `finance_order` | `net_revenue` |
| merchandising | `product_performance` | `total_sales` |
| operations | `store_portfolio` | `total_sales` |

Measured on [Order](../sales/order.md), [Product](../merchandising/product.md), [Store](../operations/store.md).
<!-- END GENERATED -->
