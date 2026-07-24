---
uri: kp:ActiveCustomer
type: defined_class
title: "Active Customer"
description: "A customer with at least one order in the last 2 years."
steward: Sales
subtype_of: kp:Customer
membership_rule: "made_an_order count > 0 within last 2 years"
tags: [Sales, approved]
status: approved
approved_by: Sales
timestamp: 2026-07-15
---

# Active Customer

A customer with at least one order in the last 2 years.

## Membership rule

`made_an_order count > 0 within last 2 years`

Apply this rule **verbatim** when querying; never improvise an equivalent filter.

Subtype of [Customer](customer.md).

## Implementations

<!-- BEGIN GENERATED: implementations (written by exporter; do not edit) -->
_Defined in the Knowledge Plane but not yet linked from any Malloy model._
<!-- END GENERATED -->
