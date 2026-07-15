---
type: eval
title: Membership rule applied verbatim
category: membership
question: "How many active customers do we have?"
expect_kind: numeric
expect_value: null
gold_query: "run: customer_order_in_context -> { aggregate: active_customer_count }"
must_use: kp:ActiveCustomer
---
Must use the bound measure for kp:ActiveCustomer. Failure: a hand-written 2-year filter (may differ from the bound rule, and must anchor to data max_date, not today).
