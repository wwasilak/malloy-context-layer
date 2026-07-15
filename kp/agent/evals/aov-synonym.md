---
type: eval
title: AOV synonym resolution
category: synonym
question: "What was the AOV in 2023?"
expect_kind: numeric
expect_value: null   # fill from gold query below, then set last_validated on the concept
gold_query: "run: sales_order -> { aggregate: average_order_value; where: order_date.year = @2023 }"
must_use: kp:AverageOrderValue
---
Tests that "AOV" routes to kp:AverageOrderValue via synonyms, not an improvised sum/count.
