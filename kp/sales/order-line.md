---
uri: kp:OrderLine
type: entity
title: "Order Line"
description: "A single line on an order, recording one product, its quantity and the prices applied at sale time."
synonyms: ["order row"]
steward: Sales
preferred_source: base.order_line_in_context
relationships:
  - uri: kp:isConvertedVia
    verb: "is converted via"
    range: kp:CurrencyExchangeRate
  - uri: kp:recordsSaleOf
    verb: "records sale of"
    range: kp:Product
tags: [Sales, approved]
status: approved
approved_by: Sales
timestamp: 2026-07-15
---

# Order Line

A single line on an order, recording one product, its quantity and the prices applied at sale time.

## Relationships

- *is converted via* → [Currency Exchange Rate](../finance/currency-exchange-rate.md) (`kp:isConvertedVia`)
- *records sale of* → [Product](../merchandising/product.md) (`kp:recordsSaleOf`)

## Implementations

<!-- BEGIN GENERATED: implementations (written by exporter; do not edit) -->
| Model | Source | Field |
|---|---|---|
| base | `order_line` | *(source)* |
| base | `order_line_in_context` | *(source)* |
| merchandising | `product_line` | *(source)* |

**Preferred source:** `base.order_line_in_context`
<!-- END GENERATED -->
