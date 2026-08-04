---
type: gap_log
title: Gap log
description: Terms users asked about that have no governed concept. Append one line per miss; the modeling backlog writes itself, ranked by demand.
---

# Gap log

Format: `| date | term asked | what the agent did (refused / exploratory figure) |`

| Date | Term | Action taken |
|---|---|---|
| 2026-08-04 | bike / bicycle (product classification) | No governed category covers it — `kp:ProductCategory` has 8 values (Audio, Cameras and camcorders, Cell phones, Computers, Games and Toys, Home Appliances, Music/Movies/Audio Books, TV and Video) and none is bike. The only bike-related products are 3 `Contoso Battery charger - bike E200` SKUs filed under Computers. Answered with an exploratory `lower(ProductName) ~ '%bike%'` match, labelled ungoverned. A first answer using `~ '%ike%'` was wrong — it swept in 7 SLR-**like** cameras carrying 96% of the revenue; see `corrections.md`. |
