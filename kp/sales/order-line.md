---
uri: "kp:OrderLine"
type: entity
title: "Order Line"
description: "A single line on an order, recording one product, its quantity and the prices applied at sale time."
synonyms: ["order row"]
steward: Sales
preferred_source: "base.order_line_in_context"
relationships:
  - uri: "kp:isConvertedVia"
    verb: "is converted via"
    range: "kp:CurrencyExchangeRate"
  - uri: "kp:recordsSaleOf"
    verb: "records sale of"
    range: "kp:Product"
status: approved
timestamp: 2026-07-14T00:00:00Z
---

# Order Line

A single line on an order, recording one product, its quantity and the prices applied at sale time.

## Relationships

- *is converted via* → [Currency Exchange Rate](/kp/finance/currency-exchange-rate.md) (`kp:isConvertedVia`)
- *records sale of* → [Product](/kp/merchandising/product.md) (`kp:recordsSaleOf`)

## Implementations

<!-- BEGIN GENERATED: implementations (written by exporter; do not edit) -->
_Not yet generated — run `npm run build`._
<!-- END GENERATED -->
