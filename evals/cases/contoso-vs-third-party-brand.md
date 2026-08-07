---
type: eval
title: Contoso vs. third-party brand banding (derived, ungoverned split)
category: computation
question: "What's the average unit price and total volume sold for Contoso-brand products versus third-party brands?"
expect_kind: analysis
must_use: kp:AverageSellingPrice, kp:TotalUnits, kp:ProductBrand
expect_receipt: true
gold_query: |
  run: product_performance -> {
    group_by: brand_group is pick 'Contoso' when trim(Brand) = 'Contoso' else 'Third-party'
    aggregate: total_units
  }
  run: finance_order -> {
    group_by: brand_group is pick 'Contoso' when trim(lines.sold_product.Brand) = 'Contoso' else 'Third-party'
    aggregate: average_selling_price
  }
---

Harvested from `kp/agent/question-log.md` (2026-08-05, tier 2).

**"Contoso vs. third-party" is a derived two-bucket banding of the governed
`kp:ProductBrand`**, not a governed category itself — no `kp:ContosoBrand`
concept exists, so the split is ungoverned even though every measure feeding
it is governed. `trim(Brand) = 'Contoso'` (not a bare equality) catches
whitespace-duplicate brand values found in the raw data.

**Two governed measures reached from two different models**, per the
routing table's preferred sources: `kp:TotalUnits` grouped natively on
`merchandising.product_performance` (product grain); `kp:AverageSellingPrice`
reached through `finance.finance_order`'s `lines.sold_product` join (order
grain, since ASP is defined as net revenue over units at that grain, not
a product-level average of unit prices). Using the same source for both
would either lose the order-level ASP definition or force an unsupported
join — reaching each governed measure from its own preferred source, then
presenting both under the same banding, is the correct route rather than a
single invented join across models.

**Why `analysis`, not `query_shape`.** Two independent aggregates from two
sources have no single combined result shape to diff against; cross-checks
grade that both governed measures were reached (not re-derived) and the
ungoverned banding was disclosed.
