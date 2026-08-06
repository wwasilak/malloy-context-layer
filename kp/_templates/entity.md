---
uri: kp:MyEntity            # required, unique, kp:PascalCase
type: entity
title: My Entity
description: One-sentence business definition.
synonyms: []                # optional
steward: Sales              # required for entity — decides the folder
# relationships:            # only on the DOMAIN side of a relationship
#   - uri: kp:hasThing
#     verb: has thing
#     range: kp:OtherEntity
allowed_roles: []          # optional: restrict who may see this concept
last_validated: null        # stamped by the eval runner - do not edit
status: draft               # draft | stable | deprecated (OKF v0.2 lifecycle)
generated: { by: human:sales, at: 2026-01-01T00:00:00Z }   # who/when authored the current content
# verified: { by: human:sales, at: 2026-01-01T00:00:00Z }  # add on steward sign-off; status -> stable then.
#   Governance gate: the agent only routes to a concept that is BOTH
#   status: stable AND has a human: verified entry (trust tier = human-reviewed).
---

# My Entity

Longer prose: context, scope notes, edge cases, examples.

## Implementations

<!-- BEGIN GENERATED: implementations (written by exporter; do not edit) -->
<!-- END GENERATED -->
