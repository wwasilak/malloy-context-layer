---
uri: kp:Order
type: entity
title: Order
description: "A purchase transaction placed by a customer at a store on a given date, composed of one or more order lines."
steward: Sales
preferred_source: base.sales_order
relationships:
  - uri: kp:consistsOf
    verb: "consists of"
    range: kp:OrderLine
  - uri: kp:isPlacedAt
    verb: "is placed at"
    range: kp:Store
  - uri: kp:isPlacedBy
    verb: "is placed by"
    range: kp:Customer
  - uri: kp:occursOn
    verb: "occurs on"
    range: kp:CalendarDate
tags: [Sales]
status: stable
generated: { by: human:sales, at: 2026-07-15T00:00:00Z }
verified: { by: human:sales, at: 2026-07-15T00:00:00Z }
---

# Order

A purchase transaction placed by a customer at a store on a given date, composed of one or more order lines.

## Relationships

- *consists of* → [Order Line](order-line.md) (`kp:consistsOf`)
- *is placed at* → [Store](../operations/store.md) (`kp:isPlacedAt`)
- *is placed by* → [Customer](customer.md) (`kp:isPlacedBy`)
- *occurs on* → [Calendar Date](../finance/calendar-date.md) (`kp:occursOn`)

## Implementations

<!-- BEGIN GENERATED: implementations (written by exporter; do not edit) -->
| Model | Source | Field |
|---|---|---|
| base | `customer_order_in_context` | `made_an_order` |
| base | `order` | *(source)* |
| base | `order_line_in_context` | `of_order` |
| base | `sales_order` | *(source)* |
| finance | `finance_order` | *(source)* |
| operations | `operations_order` | *(source)* |
| sales | `sales_performance` | *(source)* |

**Preferred source:** `base.sales_order`
<!-- END GENERATED -->
