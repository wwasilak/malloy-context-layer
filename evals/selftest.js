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
//   WHAT A TIER-1 CASE CAN STILL BE ASKED. The tier-1 prompt injects the
//   routing table, so any assertion answerable FROM THAT TABLE — which concept
//   a term resolves to, which binding to query, whether a term is governed at
//   all — is satisfied whether or not CLAUDE.md is on disk. That is a property
//   of the lane, not a defect in a case.
//
//   It does NOT follow that tier 1 is blind to the protocol, and the 2026-08-03
//   audit measured the difference: `aov-synonym` produced a receipt under the
//   real protocol and none under the stripped one, on the same question. So
//   CLAUDE.md still does work at tier 1, and a tier-1 case that asserts
//   something the routing table cannot supply — the AGT-1 receipt is the
//   available lever — discriminates like any other.
//
//   Only a case whose ENTIRE right answer is readable off the injected table is
//   beyond this test. There is exactly one (see EXEMPT), it is listed by name
//   with its reason, and it is reported rather than silently skipped.
//
//   Usage:
//     npm run eval:selftest                       # the two known regressions
//     npm run eval:selftest -- --all              # every case (periodic audit)
//     npm run eval:selftest -- --case aov-synonym
//     npm run eval:selftest -- --runs 1
// =============================================================================
const path = require('path');
const { spawnSync } = require('child_process');

const { loadCases } = require('./lib/cases');

// The regressions from PHASE2_SPEC §0. Both are protocol-dependent: without the
// governance rules in CLAUDE.md an agent has no reason to prefer a bound
// measure over raw columns, or to anchor a projection to the data's max date.
// They are the DEFAULT because they are the cheap gate; `--all` is the audit
// that asks the same question of every case, which is how a case that tests
// nothing gets found (see SIMP-5, 2026-07-31).
const REGRESSION_CASES = ['no-rederivation-margin', 'financial-situation-projection'];

// The control. See evals/protocols/README.md before editing it: it has to stay
// a plausible ungoverned analyst prompt, or the selftest proves only that the
// agent needs some instructions.
const STRIPPED = path.join('evals', 'protocols', 'stripped-analyst.md');

// Cases this test cannot decide, by name and with the reason. An exemption is a
// claim about a case, so it is written down and reviewed — not inferred from a
// tier, which would quietly exempt every future tier-1 case as well.
//
// Keep this list as short as the evidence allows. `aov-synonym` was on it for
// about an hour on 2026-08-03, until the audit showed the stripped protocol
// cost it its receipt: it had a lever, it just was not pulling it.
const EXEMPT = {
  'refusal-routing-decision':
    'the whole right answer is "CLV is absent from the routing table", and the harness injects that table — ' +
    'so the answer is readable off the prompt with any protocol. It also produces no figure, hence no receipt to assert.',
  'refusal-returns-not-in-data':
    'data absence, not governance absence: no returns table/field/proxy exists anywhere in the schema, which is ' +
    'verifiable from one compile regardless of protocol — same class as refusal-routing-decision. It also produces ' +
    'no figure, hence no receipt to assert.',
};

const run = (args) => spawnSync(process.execPath, [path.join('evals', 'run.js'), ...args], {
  stdio: 'inherit',
  env: { ...process.env, EVAL_RESULTS_DIR: path.join('evals', 'results', 'selftest') },
});

(async () => {
  const argv = process.argv.slice(2);
  let runs = 1; // one run per phase: this is a harness check, not a quality sweep
  let cases = null;
  let all = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--runs') runs = parseInt(argv[++i], 10);
    else if (argv[i] === '--all') all = true;
    else if (argv[i] === '--case') cases = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else throw new Error(`unknown flag: ${argv[i]}`);
  }

  const declared = Object.fromEntries(loadCases().map((c) => [c.name, c.tier]));
  const CASES = cases || (all ? Object.keys(declared).sort() : REGRESSION_CASES);
  for (const c of CASES)
    if (!Object.prototype.hasOwnProperty.call(declared, c)) throw new Error(`no such eval case: ${c}`);
  // A stale exemption is an invisible hole: the case is renamed or deleted, the
  // entry stays, and one day it silently matches something else.
  for (const c of Object.keys(EXEMPT))
    if (!Object.prototype.hasOwnProperty.call(declared, c)) throw new Error(`EXEMPT names a case that does not exist: ${c}`);

  // run.js: 0 = passed, 1 = a case failed, 2 = nothing ran. That third code is
  // load-bearing HERE and almost nowhere else. Phase 1 EXPECTS failure, so a
  // run that never happened — a dirty CLAUDE.md, a leftover backup, a missing
  // protocol file — would otherwise deliver exactly the answer this phase is
  // hoping for, and the selftest would certify a harness it never exercised.
  const phase = (label, args) => {
    console.log(`\n=== ${label} ===\n`);
    const out = {};
    for (const c of CASES) {
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
  const info = [];
  for (const c of CASES) {
    const detects = results.stripped[c] === false && results.real[c] === true;
    // Exempt by name, with the reason printed. Never fails the gate — but it is
    // reported every run, so an exemption someone stopped believing in is
    // visible rather than buried in a constant.
    if (EXEMPT[c]) {
      info.push(`  INFO ${c}: stripped=${results.stripped[c] ? 'pass' : 'fail'}, real=${results.real[c] ? 'pass' : 'fail'}` +
        ` — exempt: ${EXEMPT[c]}`);
      continue;
    }
    if (!detects) ok = false;
    const why = results.stripped[c]
      ? 'passed WITHOUT the governance protocol — the case does not test the protocol'
      : results.real[c] === false
        ? 'fails WITH the real protocol — the case or the protocol is broken'
        : 'discriminates correctly';
    console.log(`  ${detects ? 'OK  ' : 'BAD '} ${c}: stripped=${results.stripped[c] ? 'pass' : 'fail'}, real=${results.real[c] ? 'pass' : 'fail'} — ${why}`);
  }
  if (info.length) {
    console.log('');
    info.forEach((l) => console.log(l));
  }

  const graded = CASES.filter((c) => !EXEMPT[c]);
  console.log('');
  if (!graded.length) {
    console.log('Nothing gradeable was run — every selected case is exempt, so nothing was decided.');
    process.exit(1);
  }
  console.log(ok
    ? `Harness detects what it is for: ${graded.length} case(s) fail without the protocol and pass with it.`
    : 'Harness does NOT discriminate. A green suite would not mean the protocol works.');
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error('FATAL:', e.stack || e);
  process.exit(1);
});
