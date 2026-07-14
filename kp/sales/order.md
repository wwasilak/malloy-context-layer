---
uri: "kp:Order"
type: entity
title: Order
description: "A purchase transaction placed by a customer at a store on a given date, composed of one or more order lines."
steward: Sales
preferred_source: "base.sales_order"
relationships:
  - uri: "kp:consistsOf"
    verb: "consists of"
    range: "kp:OrderLine"
  - uri: "kp:isPlacedAt"
    verb: "is placed at"
    range: "kp:Store"
  - uri: "kp:isPlacedBy"
    verb: "is placed by"
    range: "kp:Customer"
  - uri: "kp:occursOn"
    verb: "occurs on"
    range: "kp:CalendarDate"
status: approved
timestamp: 2026-07-14T00:00:00Z
---

# Order

A purchase transaction placed by a customer at a store on a given date, composed of one or more order lines.

## Relationships

- *consists of* → [Order Line](/kp/sales/order-line.md) (`kp:consistsOf`)
- *is placed at* → [Store](/kp/operations/store.md) (`kp:isPlacedAt`)
- *is placed by* → [Customer](/kp/sales/customer.md) (`kp:isPlacedBy`)
- *occurs on* → [Calendar Date](/kp/finance/calendar-date.md) (`kp:occursOn`)

## Implementations

<!-- BEGIN GENERATED: implementations (written by exporter; do not edit) -->
_Not yet generated — run `npm run build`._
<!-- END GENERATED -->
