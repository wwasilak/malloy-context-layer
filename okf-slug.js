// =============================================================================
// okf-slug.js — the ONE JavaScript definition of the actor slug (OKF-8).
//
//   `slugify` and `actorFor` mint the `human:<steward>` actor that stamps
//   `generated`/`verified`. The migration (migrate-okf-02.js) and the Excel
//   round-trip (excel_to_okf.py) must produce the SAME actor for the same
//   steward, or a re-run silently rewrites provenance. This file is the JS
//   side; okf_slug.py is the Python side; test/unit.test.js pins both against
//   one golden table AND runs the two implementations head-to-head.
// =============================================================================
const slugify = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const actorFor = (steward) => `human:${slugify(steward || 'global')}`;

module.exports = { slugify, actorFor };
