---
type: gap_log
title: Gap log
description: Terms users asked about that have no governed concept. Append one line per miss; the modeling backlog writes itself, ranked by demand.
---

# Gap log

Format: `| date | term asked | what the agent did (refused / exploratory figure) |`

| Date | Term | Action taken |
|---|---|---|
| 2026-08-04 | bike / bicycle (product classification) | Not a governed category (kp:ProductCategory has 8 values, none of them bike). Answered with an ungoverned `lower(ProductName) ~ '%bike%'` match, labelled exploratory. See corrections.md. |
| 2026-08-05 | North America (region grouping) | No governed region or continent concept; only country-level attributes exist. Answered with an ungoverned `kp:CustomerCountry in ('US','CA')` grouping, labelled exploratory. See corrections.md. |
| 2026-08-05 | Product returns / return reasons | Not governed and not in the underlying data at all — no returns table, no return-reason field, no proxy (e.g. negative quantity) anywhere in `ParquetFiles/` or `models/`. Refused; no exploratory figure offered since none is computable. |
