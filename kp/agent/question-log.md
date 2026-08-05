---
type: question_log
title: Question log
description: Novel analytical questions and how they were answered - concepts used, method, tier. Routine lookups are not logged. Recurring entries are promotion candidates (a view or governed concept); entries double as seed material for evals.
---

# Question log

Log a line for NOVEL analyses only (new composition, projection, derived
comparison) - not routine metric lookups.

| Date | Question | Concepts used | Method | Tier |
|---|---|---|---|---|
| 2026-08-04 | Total sales variance between years | kp:TotalSales | YoY change and % via `lag()` | 2 |
| 2026-08-04 | Top 5 customers buying "bikes" | kp:TotalSales | Governed measure sliced by an ungoverned product-name filter; see gap-log | 3 |
| 2026-08-05 | Which channel had the highest QoQ revenue growth in North America | kp:TotalSales, kp:SalesChannel, kp:CustomerCountry | QoQ via `lag()` on an ungoverned US+CA grouping; partial quarter excluded; see gap-log | 3 |
| 2026-08-05 | Top 5 customers by total spend, last 12 months, and their top product categories | kp:TotalSales, kp:Customer, kp:ProductCategory | Top-N ranking on kp:TotalSales grouped by kp:Customer, nested kp:ProductCategory breakdown per customer, 12-month window anchored to max_date | 2 |
| 2026-08-05 | Discount levels offered and order counts, by year | kp:GrossRevenue, kp:DiscountAmount, kp:DiscountRate, kp:OrderCount, kp:LineDiscount, kp:LineListRevenue | Year-by-year governed discount summary; per-order banding blocked (OrderKey internal, see corrections.md) so band histogram computed on lines instead, counted by line not order | 2 |
| 2026-08-05 | Discount levels offered and order counts, by year (redo after OrderKey made public) | kp:DiscountRate, kp:OrderCount | Per-order discount-rate banding via two-stage pipeline (group by OrderKey -> band -> count); totals reconcile against kp:OrderCount; see corrections.md for the resolved OrderKey limitation | 2 |
| 2026-08-05 | Avg delivery time and highest delay rates by country, Online orders, 2023 | kp:AvgDeliveryDays, kp:DeliveredWithin3DaysRate, kp:CustomerCountry | delay_rate is 1 - kp:DeliveredWithin3DaysRate (derived complement of governed on-time threshold); grouped by kp:CustomerCountry per the Online/StoreCountry standing hint | 2 |
