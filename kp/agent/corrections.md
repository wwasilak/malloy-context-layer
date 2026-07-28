---
type: corrections
title: Corrections
description: Steward-confirmed wrong answers and their causes. Each entry routes to a fix - a definition edit (governed) or a hint below (ungoverned, reviewed).
---

# Corrections

Format per entry: date, question, wrong answer given, root cause, fix applied.

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
