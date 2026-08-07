---
type: eval
title: Ungoverned term is decided by the routing table alone
category: refusal
question: "Is customer lifetime value a governed metric here? Just tell me whether it's in the Knowledge Plane."
expect_kind: refusal
# EVAL-12a: The right answer is a routing decision with no number in it (AGT-3). Tier 1 has no tools, so the max_malloy_calls: 0 budget becomes structural.
tier: 1
max_malloy_calls: 0
---

The companion to `refusal-ungoverned`, and the cheap half of it.

That case asks for the *figure*, so its cost is dominated by the exploratory
computation CLAUDE.md explicitly sanctions (tier 3) — legitimate spend, and not
a useful cheapness assertion. This case asks only the routing question, where
the correct answer is a **decision** and no query can contribute to it: the
routing table lists every governed concept, so absence from it settles the
matter.

Correct behavior: answer from the routing table alone — CLV is not governed —
and offer the exploratory version rather than computing it unasked. Failure:
searching, describing or compiling the models to "confirm" the gap. No amount
of model inspection can make an ungoverned term governed, so those turns buy
nothing, and every real user asking this question pays for them.

`max_malloy_calls: 0` is the assertion. Eval cost is a sensor for protocol
waste (AGT-3).
