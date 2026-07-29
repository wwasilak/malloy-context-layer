---
uri: kp:Margin
type: measure
title: Margin
description: "Gross margin: total sales minus total cost."
tags: [global, approved]
status: approved
timestamp: 2026-07-15
last_validated: 2026-07-28
---

# Margin

Gross margin: total sales minus total cost.

## Implementations

<!-- BEGIN GENERATED: implementations (written by exporter; do not edit) -->
| Model | Source | Field |
|---|---|---|
| base | `sales_order` | `margin` |
| finance | `finance_order` | `gross_profit` |
| merchandising | `product_performance` | `margin` |

Measured on [Order](../sales/order.md), [Product](../merchandising/product.md).
<!-- END GENERATED -->
