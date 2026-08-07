---
type: eval
title: Standing hint applied — the active-customer window is disclosed
category: coverage
question: "How many active customers do we have?"
expect_kind: contains
expect_contains: ["wall clock"]
must_use: kp:ActiveCustomer
expect_receipt: true
---

Harvested from `kp/agent/corrections.md` (EVAL-5: corrections become cases).

**The standing hint under test.** `kp:ActiveCustomer`'s bound measure compiles
"last 2 years" against `LOCALTIMESTAMP`, not against the data's max date. With
coverage ending 2024-04-20 that window has slid almost entirely past the data,
so the count keeps falling on calendar boundaries with no data change and no
definition change. The hint's requirement: *when reporting active-customer
figures, state the window the measure actually applied.*

Nothing tested that. CLAUDE.md tells the agent to check Standing hints before
answering, and `corrections.md` is inside the semantic identity precisely
because editing it can move an answer — but no case asserted that the pathway
works. This one does.

## Why the same question as `membership-verbatim`

Deliberate, and the duplication is the point. The hint requires the agent to
**volunteer** the window on the plain question. Asking "…and what window does it
cover?" would test something weaker — that the agent answers what it was asked.
`membership-verbatim` grades the METHOD (`query_shape`, is the bound measure
used verbatim); this grades the DISCLOSURE. Same question, two different
failures, and a `query_shape` case cannot carry `expect_contains`.

## Why `"wall clock"`, and how it was chosen

Not guessed — measured. Every candidate phrase was tested against the 10
recorded runs of this question (7 correct, 3 incorrect):

| candidate | in correct | in incorrect | |
|---|---|---|---|
| `wall clock` | 7/7 | 0/3 | **chosen** |
| `LOCALTIMESTAMP` | 6/7 | 0/3 | fails a correct answer |
| `2024-04-20` | 7/7 | 2/3 | the wrong answers cite it too |
| `last 2 years`, `window` | 7/7 | 3/3 | no discrimination at all |

The three incorrect runs are instructive: two of them state the window is
"anchored to the data's max order date (2024-04-20), not today" — the exact
inversion of the defect — while quoting the right coverage date. So a check on
the date would have passed an answer that says the opposite of the truth.
`wall clock` is the phrase that separates understanding the defect from
reciting numbers near it.

**Known fragility, and what to do about it.** This is a single substring against
free prose. If a future answer says "system clock" or "current date" instead,
the case fails correct behaviour — which is worse than not testing it. If that
happens, do NOT quietly widen the string until it passes: re-run the phrase
table above against fresh runs and pick on evidence again, or convert the case
to a kind that grades something sturdier. `expect_receipt` is here as a second,
non-prose assertion so the case is not resting entirely on one phrase.
