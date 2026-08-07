---
type: eval
title: Market-basket co-occurrence (self-join on OrderKey)
category: computation
question: "Which products are most frequently purchased together with Fabrikam Laptops in the same order?"
expect_kind: analysis
must_use: kp:OrderLine, kp:Product
must_not_contain: ["= 'Fabrikam Laptops'", "ProductName = \"Fabrikam Laptops\""]
expect_receipt: true
gold_query: |
  run: order_line_in_context extend {
    join_many: co_line is order_line_in_context on co_line.OrderKey = OrderKey
  } -> {
    where: sold_product.Brand = 'Fabrikam' and sold_product.SubCategoryName = 'Laptops'
      and not (co_line.sold_product.Brand = 'Fabrikam' and co_line.sold_product.SubCategoryName = 'Laptops')
    group_by: co_line.sold_product.ProductName
    aggregate: co_order_count is count(co_line.OrderKey)
    order_by: co_order_count desc
    limit: 10
  }
---

Harvested from `kp/agent/question-log.md` (2026-08-05, tier 2).

**Method.** The anchor set is orders containing a line with `Brand =
'Fabrikam'` and `SubCategoryName = 'Laptops'` (there is no single
`ProductName` literally "Fabrikam Laptops" — `must_not_contain` catches an
agent that invents one instead of filtering brand + subcategory). The pattern
matches the LITERAL-EQUALITY misuse (`= 'Fabrikam Laptops'`), not the phrase
itself — a correct answer says "there's no product literally named 'Fabrikam
Laptops'" in prose, using the same words to explain why it filtered on brand
and subcategory instead, and a bare-phrase pattern flagged that correct
explanation as if it were the mistake (found harvesting this case,
2026-08-06).

Reaching "other lines of the same order" needs a self-join
(`order_line_in_context extend { join_many: co_line is order_line_in_context
on co_line.OrderKey = OrderKey }`) — a plain `where:` on the same join path
used inside a nest does not work here: Malloy applies it uniformly across the
query rather than as a semi-join, so the anchor filter and the
exclude-self-from-co-occurrence filter collide and the result is empty. This
was found by trial while authoring `gold_query` and is worth knowing before
attempting a simpler shape.

**Why `analysis`, not `query_shape`.** Market-basket co-occurrence has no
single canonical presentation (top N products, minimum co-occurrence
threshold, counted by order vs. by line) — cross-checks grade that the
governed `kp:OrderLine`/`kp:Product` concepts were reached and a receipt was
produced, not one exact shape.
