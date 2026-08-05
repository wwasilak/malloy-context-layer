---
type: corrections
title: Corrections
description: Steward-confirmed wrong answers and their causes. Each entry routes to a fix - a definition edit (governed) or a hint below (ungoverned, reviewed).
---

# Corrections

Format per entry: date, question, wrong answer given, root cause, fix applied.

## Entries

### 2026-08-04 — "Do we sell anything like bikes, and if yes who are our top 5 clients?"

**Wrong answer given.** "Yes! We sell bike products" followed by a top-5 table
headed *Bike Revenue*: Freddie Begum $4,170.03, Maya Young $3,939.21, Faith Cook
$3,603.29, Alexandra Hanson $3,500.60, Dieter Ziegler $3,453.15. Logged to the
question log as tier 2. Receipt read `Basis: kp:TotalSales (governed), filtered
by product name match`.

**Every one of those five names is wrong, and so is every figure.** The filter
was `ProductName ~ '%ike%'`, which matches `A. Datum SLR-like Digital Camera
M400` in seven colours as readily as it matches the three `Contoso Battery
charger - bike E200` products. The cameras carry $1,811,004 of the matched
revenue against the chargers' $79,099 — **96% of what was reported as "bike
revenue" was cameras.** The real top five, on `lower(ProductName) ~ '%bike%'`,
are Spencer Spencer $548.69, Abbie Fitzgerald $547.21, Scott Sheppard $523.37,
Mariano Padovesi $520.39, Harvey Barnes $506.12 — a disjoint set of people at an
eighth of the reported amounts.

**Root cause: the verification step in CLAUDE.md was performed and then
ignored.** The session ran a product-name probe whose output listed the SLR-like
cameras on screen, then reused the same `%ike%` pattern for the customer query
and labelled the column *Bike Revenue*. The evidence was in the transcript. What
was missing was the required act of `group_by`-ing the matched values **into the
answer** so the user could judge the filter — a check that is only worth
anything when its result is allowed to change the answer.

**Contributing causes, all four of them protocol steps that were skipped:**
tier misclassified as 2 (a governed measure cut by an ungoverned name filter is
tier 3); the figure was not marked ungoverned in the answer or the receipt; the
matched filter was not quoted; and no gap-log line was written for the missing
classification. `kp:ProductCategory` is governed, and its eight values contain
no bike category — that absence is the real finding and the answer buried it
under "Yes!".

**Fix applied.** Question log corrected to tier 3 with the contamination named;
gap log records that "bike" has no governed classification; corrected figures
issued with an ungoverned receipt. Candidate eval case: a name-match question
where the naive pattern is provably contaminated, asserting the answer both
reports the ungoverned basis and shows what matched. See `kp/agent/gap-log.md`.

## Standing hints (reviewed, ungoverned)

- **kp:ActiveCustomer counts decay with the wall clock.** The bound measure
  `base.customer_order_in_context.is_active_customer` compiles its "last 2
  years" window against `LOCALTIMESTAMP`, not against the data's `max_date`.
  With coverage ending 2024-04-20, that window has already slid almost entirely
  past the data, and the count will keep falling on calendar boundaries with no
  data change and no definition change. When reporting active-customer figures,
  state the window the measure actually applied. Raised 2026-07-28 by the eval
  runner (`membership-verbatim`, graded on method for this reason); a fix
  changes a governed membership rule and needs a steward PR against
  `kp/sales/active-customer.md` + `models/base.malloy`.

These are read before answering, which is the point: each one changes what
the next agent does on a question it has not seen yet.

- **`kp:StoreCountry` is not a place for Online orders.** `store.CountryName`
  doubles as the discriminator `kp:SalesChannel` is derived from —
  `CountryName='Online'` is a channel, not a country — so store country carries
  no geography for Online orders and cannot restrict them to a region. Use
  `kp:CustomerCountry` (residency) for region work; it covers both channels, and
  on Physical store it reproduces `kp:StoreCountry` totals exactly (verified
  2026-08-05: US $711,444,432.44 both ways). *Proposed caveat for the steward of
  `kp:StoreCountry` (Retail Operations).*

- **RESOLVED 2026-08-05 — `OrderKey` was internal, blocking per-order
  distributions.** `order`/`sales_order`/`finance_order` used to mark
  `OrderKey` (and several other keys) `internal`, so no query could
  `group_by: OrderKey` to get one row per order — any "how many ORDERS fall
  into band X" question (discount rate, order value, ...) was not computable
  at order grain. The steward changed every `internal:` field in
  `base.malloy` to `public:` the same day; `group_by: OrderKey` and the
  two-stage per-order pipeline (group by key -> band the per-row measure ->
  count) now compile and the totals reconcile against `kp:OrderCount` (e.g.
  2015: 6,443+18,012+9,125 = 33,580). Note the fix was broader than `OrderKey`
  alone — `StoreKey`, `ProductKey`, `CategoryKey`, `RowNumber`, `UnitPrice`,
  `GeoAreaKey`, `DateKey` etc. are now all public too; no problem has
  surfaced from that yet, but it's a wider surface than this one question
  needed, worth the steward's eyes if it wasn't intentional.

- **Name-pattern filters need their matches shown.** `~ '%ike%'` for "bike" swept
  in seven SLR-like cameras carrying 96% of the revenue. Any name match standing
  in for a category must be `group_by`-ed and displayed before the figure is
  reported. *General; no single concept owns it.*
