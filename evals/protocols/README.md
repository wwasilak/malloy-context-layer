# Control protocols for `run.js --protocol <path>`

A file in here is swapped in for `CLAUDE.md` while the runner works, so **the
agent under test reads it verbatim, comments and all**. The rules for editing
one therefore live in this README and never inside the protocol itself: a
control that names the very things it is controlling for is telling the agent
what to reach for.

## `stripped-analyst.md`

The control for `npm run eval:selftest`. The two regression cases must FAIL
against it and PASS against the shipped `CLAUDE.md`; only a harness that does
both is worth gating a PR on.

It must stay a **plausible, competent, ungoverned analyst prompt — not a
strawman**. The claim under test is that the Knowledge Plane's governance rules
change what the agent does. An empty file, or a deliberately broken one, would
prove only that the agent needs some instructions, which nobody doubts.

So: it may say anything a sensible analyst prompt would say about querying
Malloy. It may not mention concepts, bindings, the routing table, governed
metrics, membership rules, tiers or receipts — everything the selftest exists to
detect must be absent here and present in `CLAUDE.md`.

## When the selftest reports BAD

`stripped=pass` means the case does not test the protocol. Before editing the
control, check the case: on 2026-07-31 `financial-situation-projection` passed
here because its only cross-check was `must_use`, and every approved concept URI
appears in `models/*.malloy` as a `# concept` annotation — so compiling a model
echoed the required URIs into the trace and satisfied the check without the
agent routing to anything. The fix belonged in the case (`expect_receipt`), not
in this prompt. Weakening the control to make a case fail proves nothing.
