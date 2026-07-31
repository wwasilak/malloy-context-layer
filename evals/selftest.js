#!/usr/bin/env node
// =============================================================================
// selftest.js — does the harness detect what it exists to detect?
//
//   A suite that passes everything is indistinguishable from a suite that
//   grades nothing. So: take the two regressions we actually saw in real
//   sessions, run them against a deliberately stripped protocol, and require
//   them to FAIL. Then run them against the real one and require them to PASS.
//   Only a harness that does both is worth gating a PR on.
//
//   SIMP-5 left this file with the part that is genuinely its own — deciding
//   which cases discriminate, and saying so — and moved the mechanics into
//   `run.js --protocol <path>`. What used to live here was a backup file, a
//   dirty-tree guard, a restore in a `finally` and a SIGINT handler, all of it
//   because this script rewrote a tracked file that `run.js` then read. Now
//   `run.js` owns the swap for the same reason it owns everything else about a
//   run's lifecycle, and the control prompt is a reviewable file
//   (`evals/protocols/stripped-analyst.md`) instead of a string literal in
//   here.
//
//   Usage: npm run eval:selftest [-- --runs 1]
// =============================================================================
const path = require('path');
const { spawnSync } = require('child_process');

// The regressions from PHASE2_SPEC §0. Both are protocol-dependent: without the
// governance rules in CLAUDE.md an agent has no reason to prefer a bound
// measure over raw columns, or to anchor a projection to the data's max date.
const REGRESSION_CASES = ['no-rederivation-margin', 'financial-situation-projection'];

// The control. Read the comment inside it before editing: it has to stay a
// plausible ungoverned analyst prompt, or the selftest proves only that the
// agent needs some instructions.
const STRIPPED = path.join('evals', 'protocols', 'stripped-analyst.md');

const run = (args) => spawnSync(process.execPath, [path.join('evals', 'run.js'), ...args], {
  stdio: 'inherit',
  env: { ...process.env, EVAL_RESULTS_DIR: path.join('evals', 'results', 'selftest') },
});

(async () => {
  const argv = process.argv.slice(2);
  let runs = 1; // one run per phase: this is a harness check, not a quality sweep
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--runs') runs = parseInt(argv[++i], 10);
    else throw new Error(`unknown flag: ${argv[i]}`);
  }

  // run.js: 0 = passed, 1 = a case failed, 2 = nothing ran. That third code is
  // load-bearing HERE and almost nowhere else. Phase 1 EXPECTS failure, so a
  // run that never happened — a dirty CLAUDE.md, a leftover backup, a missing
  // protocol file — would otherwise deliver exactly the answer this phase is
  // hoping for, and the selftest would certify a harness it never exercised.
  const phase = (label, args) => {
    console.log(`\n=== ${label} ===\n`);
    const out = {};
    for (const c of REGRESSION_CASES) {
      const r = run(['--case', c, '--runs', String(runs), '--no-stamp', ...args]);
      if (r.error) throw new Error(`run.js could not start for ${c}: ${r.error.message}`);
      if (r.status !== 0 && r.status !== 1)
        throw new Error(`run.js produced no verdict for ${c} (exit ${r.status}${r.signal ? `, signal ${r.signal}` : ''}) — see its output above`);
      out[c] = r.status === 0;
    }
    return out;
  };

  const results = {
    stripped: phase(`phase 1: ${STRIPPED} (regressions must FAIL)`, ['--protocol', STRIPPED]),
    real: phase('phase 2: the shipped CLAUDE.md (regressions must PASS)', []),
  };

  // ---- verdict -------------------------------------------------------------
  console.log('\n=== selftest verdict ===\n');
  let ok = true;
  for (const c of REGRESSION_CASES) {
    const detects = results.stripped[c] === false && results.real[c] === true;
    if (!detects) ok = false;
    const why = results.stripped[c]
      ? 'passed WITHOUT the governance protocol — the case does not test the protocol'
      : results.real[c] === false
        ? 'fails WITH the real protocol — the case or the protocol is broken'
        : 'discriminates correctly';
    console.log(`  ${detects ? 'OK  ' : 'BAD '} ${c}: stripped=${results.stripped[c] ? 'pass' : 'fail'}, real=${results.real[c] ? 'pass' : 'fail'} — ${why}`);
  }

  console.log('');
  console.log(ok
    ? 'Harness detects what it is for: the regressions fail without the protocol and pass with it.'
    : 'Harness does NOT discriminate. A green suite would not mean the protocol works.');
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error('FATAL:', e.stack || e);
  process.exit(1);
});
