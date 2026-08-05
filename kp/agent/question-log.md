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
| 2026-08-05 | Products most frequently purchased together with Fabrikam Laptops in the same transaction | kp:OrderLine, kp:Product | Market-basket co-occurrence: anchor set = orders containing a Fabrikam-brand, Laptops-subcategory line; self-joined order_line_in_context on OrderKey to count distinct co-occurring orders per other product, excluding other Fabrikam Laptop SKUs from the co-occurring side | 2 |
| 2026-08-05 | Average unit price and total volume sold for Contoso Brand vs. third-party brands | kp:AverageSellingPrice, kp:TotalUnits, kp:ProductBrand | Derived two-bucket banding of kp:ProductBrand (Contoso vs Third-party) via `trim(Brand) = 'Contoso'` to catch whitespace-duplicate brand values; kp:AverageSellingPrice reached through the lines.sold_product join on finance_order, kp:TotalUnits from product_performance grouped natively | 2 |
| 2026-08-05 | Does >10% discount on Home Appliances increase unit volume or just erode margin | kp:LineDiscount, kp:LineListRevenue, kp:LineRevenue, kp:LineCost, kp:LineQuantity, kp:ProductCategory | Line-grain discount-rate band (LineDiscount/LineListRevenue > 10%, a derived ratio of governed line measures, no line-grain kp:DiscountRate binding exists) filtered to Home Appliances; compared avg units per line and margin% across bands | 2 |
| 2026-08-05 | Same question, restricted to products sold at both discount levels (control for product-mix confound) | kp:LineDiscount, kp:LineListRevenue, kp:LineRevenue, kp:LineCost, kp:LineQuantity, kp:ProductCategory | Self-join to find ProductKeys present in both discount bands (all 661 Home Appliance products qualified); result identical to unrestricted version, ruling out product-mix as the explanation | 2 |
