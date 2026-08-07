---
type: eval
title: Online delivery delay grouped by customer country, not store country
category: coverage
question: "What's the average delivery time and highest delay rates by country, for Online orders in 2023?"
expect_kind: query_shape
gold_query: |
  run: operations_order -> {
    where: channel = 'Online' and DT.year = @2023
    group_by: placed_by.Country
    aggregate: avg_delivery_days, delivered_within_3d_rate, delay_rate is 1 - delivered_within_3d_rate
    order_by: delay_rate desc
  }
must_use: kp:AvgDeliveryDays, kp:DeliveredWithin3DaysRate, kp:CustomerCountry
must_not_contain: ["group_by: placed_at.CountryName", "group_by: placed_at.CountryCode", "group_by: placed_at.Country"]
must_not_contain_scope: final
expect_receipt: true
---

Harvested from `kp/agent/question-log.md` (2026-08-05, tier 2) — exercises the
`kp:StoreCountry` / Online standing hint in `corrections.md`, which until now
had no case asserting the pathway actually works (the same gap
`standing-hint-window` closed for the active-customer window, applied to a
different standing hint).

**The standing hint under test.** `store.CountryName` doubles as the
`kp:SalesChannel` discriminator — `CountryName = 'Online'` is a channel
value, not a place — so grouping Online orders by `kp:StoreCountry` carries
no geography for them. The correct dimension for a per-country breakdown
that includes Online orders is `kp:CustomerCountry` (`placed_by.Country`),
verified in the hint to reproduce `kp:StoreCountry` totals exactly on
Physical-store-only slices.

**Why `query_shape`.** This is now a closed-form question with one correct
grouping dimension given the standing hint, so result-set comparison against
`gold_query` (8 countries, `delay_rate` computed as the complement of the
bound `kp:DeliveredWithin3DaysRate`) is the direct test. `must_not_contain`
guards the specific regression the hint exists to prevent: grouping by
`placed_at.Country*` instead.

**`must_not_contain_scope: final`.** Verifying the hint before answering
means running exactly the query the hint describes — `group_by:
placed_at.CountryName` filtered to Online, to see it collapses to one row —
which trips the forbidden pattern on a CORRECT run if every executed query is
checked. Scoped to the last executed query, since that is the one the
returned result set is drawn from (found harvesting this case, 2026-08-06).

**Delay rate is a derived complement of a governed measure**
(`1 - kp:DeliveredWithin3DaysRate`), computed inside `aggregate:` at the same
grain — not a re-derivation, since it is arithmetic over the bound measure's
own result, not a hand-rolled recomputation of what the measure counts.
