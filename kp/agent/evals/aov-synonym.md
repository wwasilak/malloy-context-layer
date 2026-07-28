---
type: eval
title: AOV synonym resolution
category: synonym
question: "What was the AOV in 2023?"
expect_kind: numeric
expect_value: 1964.2507030724498
gold_query: "run: sales_performance -> { aggregate: average_order_value; where: DT.year = @2023 }"
must_use: kp:AverageOrderValue
must_not_contain: ["total_sales/order_count", "total_sales / order_count"]
---
Tests that "AOV" routes to kp:AverageOrderValue via synonyms, not an improvised sum/count.

Gold query follows the binding in the routing table
(`sales.sales_performance.average_order_value`) and the temporal anchor
(`base.order.DT` = kp:OrderDate). 2023 is a closed historical window, so the
gold value is stable against the committed fixtures — this case can be graded
numerically without rotting.

`must_not_contain` guards the tier-3 failure specific to this concept:
re-deriving AOV as total_sales / order_count instead of using the bound
measure. Both agree today; they diverge the day the definition changes.
