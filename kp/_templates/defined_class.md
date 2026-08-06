---
uri: kp:MyDefinedClass
type: defined_class
title: My Defined Class
description: One-sentence business definition.
steward: Sales
subtype_of: kp:MyEntity     # required for defined_class
membership_rule: "the exact rule, applied verbatim"
allowed_roles: []          # optional: restrict who may see this concept
last_validated: null        # stamped by the eval runner - do not edit
status: draft               # draft | stable | deprecated (OKF v0.2 lifecycle)
generated: { by: human:sales, at: 2026-01-01T00:00:00Z }   # who/when authored the current content
# verified: { by: human:sales, at: 2026-01-01T00:00:00Z }  # add on steward sign-off; status -> stable then.
#   Governance gate: the agent only routes to a concept that is BOTH
#   status: stable AND has a human: verified entry (trust tier = human-reviewed).
---

# My Defined Class

## Membership rule

`the exact rule, applied verbatim`

Apply this rule **verbatim** when querying; never improvise an equivalent filter.

## Implementations

<!-- BEGIN GENERATED: implementations (written by exporter; do not edit) -->
<!-- END GENERATED -->
