---
type: eval
title: Membership rule applied verbatim
category: membership
question: "How many active customers do we have?"
expect_kind: query_shape
gold_query: |
  run: customer_order_in_context -> {
    group_by: CustomerKey
    having: is_active_customer
  } -> {
    aggregate: active_customer_count is count()
  }
must_use: kp:ActiveCustomer
---
Must use the bound measure for kp:ActiveCustomer
(`base.customer_order_in_context.is_active_customer`). Failure: a hand-written
2-year filter, which may differ from the bound rule.

**Why this is graded as `query_shape`, not `numeric`.** The bound measure
compiles to a window anchored on `LOCALTIMESTAMP`:

```sql
COUNT(CASE WHEN made_an_order_0."DT" >= (DATE_TRUNC('year', LOCALTIMESTAMP) - INTERVAL (2) year)
            AND made_an_order_0."DT" <  DATE_TRUNC('year', LOCALTIMESTAMP) THEN 1 END) > 0
```

so the count moves with the wall clock even when neither the data nor the
definition has changed. A pinned `expect_value` here would rot on a calendar
boundary and report a regression that never happened. Running the agent's query
against the blessed one instead grades the METHOD: both sides drift identically,
so the comparison stays valid whatever the date (EVAL-2's anchored ground truth).

**Open issue for the steward, not for this case.** That the membership rule
anchors to today rather than to the data's `max_date` contradicts the Time rule
in CLAUDE.md, and with coverage ending 2024-04-20 the "last 2 years" window has
already slid mostly past the data. Fixing it changes a governed definition and
belongs in a reviewed PR against `kp/sales/active-customer.md` and
`models/base.malloy` — see `kp/agent/corrections.md`.
