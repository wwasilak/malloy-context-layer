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
| 2026-08-04 | Total sales variance between years | kp:TotalSales | YoY change and percentage growth using `lag()` | 2 |
| 2026-08-04 | Top 5 customers buying "bikes" | kp:TotalSales (governed measure only) | kp:TotalSales sliced by an UNGOVERNED product-name filter `lower(ProductName) ~ '%bike%'` and grouped by ungoverned customer name fields. "Bike" is not a governed category — see `gap-log.md`. First attempt used `~ '%ike%'` and was wrong (matched SLR-**like** cameras, 96% of revenue) — see `corrections.md` | 3 |
