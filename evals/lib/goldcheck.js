// =============================================================================
// goldcheck.js — tier-0: everything about the eval suite that can be checked
//                without an LLM.
//
//   Three questions, all deterministic:
//     1. does every case file parse and satisfy its per-kind contract?
//     2. does every gold_query still RUN against the data?
//     3. does every committed expect_value still match what its query yields?
//
//   None of that needs an agent, so none of it belongs in a workflow that
//   spends money on one (SIMP-4). It lives here so build.js can run it on
//   every PR as part of the gate that already exists, and gold.js --check can
//   run the identical logic standalone.
//
//   A gold query that no longer compiles is a broken CASE, not a failing agent.
//   Learning that from the build is free; learning it from a sweep costs a
//   sweep and reads like a regression.
// =============================================================================
const fs = require('fs');
const { loadCases, EVALS_DIR } = require('./cases');
const mal = require('./malloy');

// Committed vs recomputed gold: relative, because these are float aggregates.
const DRIFT_EPSILON = 1e-9;
const drifted = (a, b) => Math.abs(a - b) > Math.abs(a) * DRIFT_EPSILON;

// Run every case's gold statements and compare against what is committed.
//
// Returns { lines, problems }: `lines` is the per-case report (caller decides
// how loudly to print it), `problems` is what should fail a build. Nothing is
// written — this module never mutates a case file. gold.js owns writing.
async function checkGold({ workdir, index, only = null, dir = EVALS_DIR } = {}) {
  const lines = [];
  const problems = [];

  if (!fs.existsSync(dir)) {
    lines.push(`skip   no eval cases at ${dir}`);
    return { lines, problems, cases: [] };
  }

  const cases = loadCases(dir, only);

  for (const c of cases) {
    if (c.errors && c.errors.length) {
      for (const e of c.errors) problems.push(`${c._path}: ${e}`);
      continue;
    }

    if (!c.gold_runs.length) {
      lines.push(`skip   ${c.name} — no gold_query`);
      continue;
    }

    const results = [];
    let err = null;
    for (const q of c.gold_runs) {
      try {
        results.push(await mal.runQuery(q, { workdir, index }));
      } catch (e) {
        err = e.message || String(e);
        break;
      }
    }
    if (err) {
      problems.push(`${c.name}: gold_query failed to run — ${err}`);
      continue;
    }

    if (c.expect_kind !== 'numeric') {
      lines.push(`ok     ${c.name} — ${results.length} gold query(s) run, ${results[0].rows.length} row(s) [${c.expect_kind}]`);
      continue;
    }

    const value = mal.scalarFrom(results[0].rows);
    if (value == null) {
      problems.push(`${c.name}: gold_query for a numeric case must return exactly one row with one numeric column`);
      continue;
    }
    if (c.expect_value == null) {
      problems.push(`${c.name}: expect_value not committed (gold_query yields ${value}) — run 'npm run eval:gold'`);
      continue;
    }
    if (drifted(value, c.expect_value)) {
      problems.push(`${c.name}: committed expect_value ${c.expect_value}, gold_query now yields ${value}`);
      continue;
    }
    lines.push(`ok     ${c.name} — ${value}`);
  }

  return { lines, problems, cases };
}

module.exports = { checkGold, drifted, DRIFT_EPSILON };
