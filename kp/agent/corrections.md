---
type: corrections
title: Corrections
description: Steward-confirmed wrong answers and their causes. Each entry routes to a fix - a definition edit (governed) or a hint below (ungoverned, reviewed).
---

# Corrections

Format per entry: date, question, wrong answer given, root cause, fix applied.

## 2026-07-15 — kp:ActiveCustomer time anchor uses wall-clock, not data max_date

- **Question**: verifying canonical example queries against the models.
- **Wrong behavior**: `base.customer_order_in_context.is_active_customer`
  (bound measure for `kp:ActiveCustomer`) filters with
  `made_an_order.DT ~ f'last 2 years'`, which Malloy/DuckDB resolves against
  `LOCALTIMESTAMP` (real wall-clock now), not the bundle's data coverage
  `max_date` (2024-04-20 per `kp/index.md`). CLAUDE.md's rule to anchor
  relative windows to `max_date`, not today, is violated by the model itself,
  not just by agent behavior — any answer using this measure while the real
  date is far from `max_date` (e.g. today, 2026-07-15) silently evaluates the
  wrong window.
- **Root cause**: `models/base.malloy` line ~136 uses a relative Malloy time
  literal (`f'last 2 years'`) instead of a window computed from the data's
  actual max date.
- **Fix applied**: none yet — flagging for a steward/model-owner decision:
  either parameterize `is_active_customer` off a stored max-date constant, or
  document that callers must not trust this measure until it's anchored.
  Until fixed, treat any `kp:ActiveCustomer` figure as *exploratory* and
  cross-check the implied window before presenting it as governed.

## Standing hints (reviewed, ungoverned)

(none yet)
