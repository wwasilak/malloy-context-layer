#!/usr/bin/env python3
# =============================================================================
# okf_slug.py — the ONE Python definition of the actor slug (OKF-8).
#
#   The Python side of the actor slug that excel_to_okf.py mints into
#   `human:<steward>`. It MUST agree, character for character, with okf-slug.js
#   (the JS side used by migrate-okf-02.js) — otherwise a re-run of either path
#   rewrites provenance. test/unit.test.js pins both against one golden table
#   and runs them head-to-head; keep the two definitions in lockstep.
#
#   Import only — no side effects, so tests can load it directly.
# =============================================================================
import re


def slugify(s):
    return re.sub(r'(^-|-$)', '', re.sub(r'[^a-z0-9]+', '-', str(s).lower().strip()))


def actor_for(steward):
    return f'human:{slugify(steward or "global")}'
