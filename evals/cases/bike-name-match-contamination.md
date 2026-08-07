---
type: eval
title: Governed measure sliced by an ungoverned name-match filter (bike contamination)
category: tier-boundary
question: "Do we sell anything like bikes, and if yes who are our top 5 clients?"
expect_kind: query_shape
min_match: subset
gold_query: |
  run: sales_order -> {
    where: lower(lines.sold_product.ProductName) ~ '%bike%'
    group_by: placed_by.CustomerKey
    aggregate: bike_revenue is lines.line_revenue.sum()
    order_by: bike_revenue desc
    limit: 5
  } -> {
    select: bike_revenue
  }
must_use: kp:LineRevenue, kp:Customer
expect_receipt: true
---

Harvested from `kp/agent/corrections.md` (2026-08-04 correction — EVAL-5:
corrections become cases).

**The observed failure.** The agent filtered on `ProductName ~ '%ike%'`,
which matches "A. Datum SLR-**like** Digital Camera M400" in seven colours as
readily as it matches the three `Contoso Battery charger - bike E200`
products. 96% of the reported "bike revenue" was cameras, and every one of
the five reported customer names was wrong as a result.

**The correct filter** is `lower(ProductName) ~ '%bike%'` (case-insensitive,
no truncated stem). `gold_query` reproduces the corrected figures exactly:
Spencer Spencer $548.69, Abbie Fitzgerald $547.21, Scott Sheppard $523.37,
Mariano Padovesi $520.39, Harvey Barnes $506.12.

**Why `query_shape`, not `analysis`.** The defect is mechanical — a specific
wrong pattern producing a specific wrong result set — so comparing result
sets catches it directly: the contaminated pattern returns a completely
disjoint set of customers and larger figures (cameras dominate), which fails
`gold_query` comparison outright.

**Why the gold is the five REVENUE values, and `min_match: subset`
(EVAL-18/EVAL-19, 2026-08-07).** The first version pinned customer identity by
`CustomerKey, GivenName, Surname` at `min_match: values`. A live re-audit run
answered *correctly* — same five customers, same revenues — but scored `none`,
for two presentation-only reasons: it wrapped the top-5 in a `nest:` (which
`query_shape` didn't descend into until EVAL-19), and it identified customers
as `concat(GivenName,' ',Surname)` rather than the three separate columns, so
no tier could bridge the projection. Both are legitimate ways to present a
correct answer. So the gold now pins the DISCRIMINATING signal — the five
top bike-revenue values — which the contamination changes entirely (its
camera-dominated figures are larger and different), while tolerating however
the agent chooses to project or nest its rows. `subset` (not `values`) because
the agent legitimately returns the revenue *alongside* a customer label;
extra ROWS still fail (`containsAll` requires an equal row count), so a
200-row result with these five revenues buried in it does not pass. Revenues
are customer-specific here, so the right five revenues imply the right five
customers. Depends on EVAL-19 (grader descends into the nested result).

**Why there is no `must_not_contain` (removed 2026-08-07).** An earlier version
forbade the literal `'%ike%'` pattern as "cheap insurance." It was removed
because it false-failed CORRECT answers: the question is *about* that pattern,
so a diligent agent legitimately mentions it — in a *verification* query that
demonstrates it matches cameras (`must_not_contain_scope: final` was tried and
did not help — the probe is a non-final query), and in the *answer prose* itself
("I avoided `~ '%ike%'` because…"), which no scope can exclude without also
blinding the guard to the real defect. Across four live selftest runs
(2026-08-07) the pattern guard fired on both correct real runs for exactly these
reasons. It is redundant anyway: `query_shape` against the revenue gold already
catches the contamination directly (the `'%ike%'` figures are camera-dominated
and larger, so they score `none`), and `expect_receipt` is the reliable
stripped-vs-real discriminator — both stripped runs produced no AGT-1 receipt,
both real runs did. Regression coverage is therefore query_shape + receipt +
`must_use`, per the sanctioned "drop it and rely on the cross-checks + receipt"
option.

`kp:LineRevenue` is required via `must_use`: the correct method sums the
governed line-level measure over the *filtered* (bike-only) lines rather than
hand-deriving `Quantity * NetPrice`. (Note: an inline `total_sales { where:
<bike line predicate> }` happens to AGREE numerically here — `total_sales`
compiles to a line-grain sum, so the inner filter restricts to bike lines and
does not overcount. The overcount risk is real only if `kp:TotalSales` is
filtered at the *order* grain. The case pins the answer via the revenue values,
so either correct route passes; `must_use` still requires the line-grain measure
to be reached for.)

**Tier.** 3, not 2 — "bikes" is not `kp:ProductCategory` (8 values, none of
them bike), so this is a governed measure cut by an ungoverned classification,
same rule as any other governed-measure-under-ungoverned-slice case.
