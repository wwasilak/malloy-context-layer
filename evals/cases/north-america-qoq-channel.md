---
type: eval
title: "\"North America\" is an ungoverned region grouping"
category: tier-boundary
question: "Which sales channel had the highest QoQ revenue growth in North America?"
expect_kind: analysis
must_use: kp:TotalSales, kp:SalesChannel, kp:CustomerCountry
must_not_contain: ["kp:NorthAmerica", "kp:Region", "placed_at.CountryCode", "placed_at.Country ", "placed_at.CountryName ="]
must_not_contain_scope: final
expect_receipt: true
gold_query: |
  run: sales_order -> {
    where: placed_by.Country = 'US' or placed_by.Country = 'CA'
    group_by: channel
    nest: by_quarter is {
      group_by: qtr is DT.quarter
      aggregate: total_sales
      calculate: qoq_growth is (total_sales - lag(total_sales)) / lag(total_sales)
      order_by: qtr
    }
  }
---

Harvested from `kp/agent/question-log.md` (2026-08-05, tier 3) and
`kp/agent/gap-log.md`'s "North America (region grouping)" entry.

**No governed region concept exists** — only country-level attributes
(`kp:CustomerCountry`, `kp:StoreCountry`). "North America" is answered as an
ungoverned `kp:CustomerCountry in ('US', 'CA')` grouping, labelled as such.

**Why `kp:CustomerCountry`, not `kp:StoreCountry`, and why that's asserted.**
Per the standing hint in `corrections.md`, `kp:StoreCountry` doubles as the
channel discriminator (`CountryName = 'Online'` is a channel value, not a
country), so it carries no usable geography for Online orders and would
silently misclassify or drop them from a "North America" filter. This
question spans both channels, so using `placed_at.Country*` for the region
would reproduce that exact defect. `must_not_contain` guards it directly, and
also forbids inventing a `kp:NorthAmerica`/`kp:Region` URI — an ungoverned
grouping dressed up as a governed one is worse than an ungoverned grouping
labelled honestly.

**`must_not_contain_scope: final`.** Confirming the standing hint is exactly
the diligence CLAUDE.md calls for, and doing that diligence for
`kp:StoreCountry` means running a verification query that groups by
`placed_at.Country*` to see it degenerates to `Online` — so the forbidden
pattern is expected to appear in an earlier query on a CORRECT run. Only the
query the final answer is actually drawn from is required to avoid it (found
harvesting this case, 2026-08-06: the default `all` scope failed a run that
reasoned correctly).

**Why `analysis`, not `query_shape`.** QoQ trend-and-compare admits more than
one reasonable presentation (per-channel nest vs. a flat table, which
quarters to include, how partial-quarter data is handled), so pinning one
exact result shape would fail correct variants. `gold_query` is one valid
shape (nested per-channel quarterly series with `lag()`), executed by
`eval:gold`/`eval:check` so it cannot silently stop compiling, but the case
grades the route via cross-checks rather than a result-set diff.

**Tier.** 3 — a governed measure (`kp:TotalSales`) grouped by a governed
dimension (`kp:SalesChannel`) is fine; grouping it by an ungoverned region is
what makes this tier 3, not the QoQ analysis method itself (that part is tier
2 freedom on its own).
