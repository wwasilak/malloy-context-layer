---
type: eval
title: Governed concept must not be re-derived from components
category: tier-boundary
question: "Top 5 products with highest margin for each category — use Malloy's nest feature."
expect_kind: query_shape
must_use: kp:Margin
must_not_contain: ["line_revenue - line_cost", "sum(line_revenue"]
gold_query: |
  run: sales_order -> {
    nest: categories is {
      group_by: lines.sold_product.CategoryName
      nest: top_products is {
        group_by: lines.sold_product.ProductName
        aggregate: margin
        limit: 5
        order_by: margin desc
      }
    }
  }
---
Regression case from a real session.

**Failure observed:** the agent computed `sum(line_revenue - line_cost)` on
`order_line_in_context`, re-deriving a concept that already exists
(`kp:Margin`, bound to `base.sales_order.margin`), then defended it as tier-2
analysis. Re-deriving a governed concept is tier 3, not tier 2 — the numbers
agree today and can silently diverge the moment the governed definition changes.

**Correct behavior:** a governed concept exists for the quantity, so use its
binding and reach the needed grain through joins (`lines.sold_product...`).
Different grain is not a licence to recompute.

**Also required in the answer:** provenance footer (tier, data coverage anchor,
steward) and a question-log entry — both were missing in the observed failure.
