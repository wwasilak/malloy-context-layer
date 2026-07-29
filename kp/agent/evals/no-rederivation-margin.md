---
type: eval
title: Governed concept must not be re-derived from components
category: tier-boundary
question: "Top 5 products with highest margin for each category — use Malloy's nest feature."
expect_kind: analysis
must_use: kp:Margin
must_not_contain: ["line_revenue - line_cost", "sum(line_revenue", "line_revenue-line_cost"]
expect_receipt: true
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
The footer is asserted here via `expect_receipt`; the log append is not, because
the runner denies write tools so a sweep cannot pollute the logs (the attempt is
still visible in the trace).

**Why this grades on cross-checks (`analysis`), not `query_shape`.** The
question is open-ended about presentation: "top 5 per category" is served
equally well by a top-level `group_by` with a nested `top_products`, or by the
fully-nested shape in `gold_query` below, with or without a category subtotal.
Running both queries and diffing result sets — the right test for a closed-form
question like "how many active customers" — marks those correct variants as
failures, and a suite that fails correct behaviour trains people to ignore it.

What this case actually asserts is the ROUTE, and the cross-checks test it
exactly: `must_use` requires the governed concept to be reached for, and
`must_not_contain` catches the re-derivation that was actually observed, in
whitespace-insensitive form. `gold_query` stays below as the reference
implementation and is still executed by `npm run eval:gold`, so it cannot rot
unnoticed.
