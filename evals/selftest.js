#!/usr/bin/env node
// =============================================================================
// selftest.js — does the harness detect what it exists to detect?
//
//   A suite that passes everything is indistinguishable from a suite that
//   grades nothing. So: take the two regressions we actually saw in real
//   sessions, run them against a deliberately STRIPPED CLAUDE.md, and require
//   them to FAIL. Then run them against the real one and require them to PASS.
//   Only a harness that does both is worth gating a PR on.
//
//   CLAUDE.md is moved aside and restored in a finally block; the run refuses
//   to start if CLAUDE.md already has uncommitted changes, so a crash can never
//   cost work. The backup lives next to the original and is restored on SIGINT
//   too.
//
//   Usage: npm run eval:selftest [-- --runs 1]
// =============================================================================
const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const CLAUDE_MD = 'CLAUDE.md';
const BACKUP = 'CLAUDE.md.selftest-backup';

// The regressions from PHASE2_SPEC §0. Both are protocol-dependent: without the
// governance rules in CLAUDE.md an agent has no reason to prefer a bound
// measure over raw columns, or to anchor a projection to the data's max date.
const REGRESSION_CASES = ['no-rederivation-margin', 'financial-situation-projection'];

// A plausible, competent, ungoverned analyst prompt. It must not be a strawman
// — the test is that the KP protocol changes behaviour, not that an empty file
// breaks the agent.
const STRIPPED = `---
owner: eval selftest
status: scratch
---

# Data analysis

You have Malloy models in \`models/\` over parquet data in \`ParquetFiles/\`.
Answer the user's data questions by writing and running Malloy queries.

- Inspect a model with compile before querying it.
- Always aggregate and set a low row limit.
- Be concise and show the numbers you computed.
`;

const run = (args) => spawnSync(process.execPath, [path.join('evals', 'run.js'), ...args], {
  stdio: 'inherit',
  env: { ...process.env, EVAL_RESULTS_DIR: path.join('evals', 'results', 'selftest') },
});

function guard() {
  if (fs.existsSync(BACKUP))
    throw new Error(`${BACKUP} already exists — a previous selftest did not clean up. Inspect and restore it manually.`);
  try {
    const dirty = execSync(`git status --porcelain -- ${CLAUDE_MD}`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    if (dirty)
      throw new Error(`${CLAUDE_MD} has uncommitted changes. Commit or stash them before running the selftest — it rewrites the file.`);
  } catch (e) {
    if (/uncommitted changes/.test(e.message)) throw e;
    // not a git repo / git unavailable: the backup+restore path still protects us
  }
}

let restored = false;
function restore() {
  if (restored) return;
  if (fs.existsSync(BACKUP)) {
    fs.copyFileSync(BACKUP, CLAUDE_MD);
    fs.unlinkSync(BACKUP);
  }
  restored = true;
}

(async () => {
  const argv = process.argv.slice(2);
  let runs = 1; // one run per phase: this is a harness check, not a quality sweep
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--runs') runs = parseInt(argv[++i], 10);
    else throw new Error(`unknown flag: ${argv[i]}`);
  }

  guard();

  const results = { stripped: {}, real: {} };

  process.on('SIGINT', () => { restore(); process.exit(130); });

  try {
    // ---- phase 1: stripped protocol — these MUST fail ----------------------
    fs.copyFileSync(CLAUDE_MD, BACKUP);
    fs.writeFileSync(CLAUDE_MD, STRIPPED);
    console.log('\n=== phase 1: stripped CLAUDE.md (regressions must FAIL) ===\n');
    for (const c of REGRESSION_CASES) {
      const r = run(['--case', c, '--runs', String(runs), '--no-stamp']);
      results.stripped[c] = r.status === 0; // 0 = passed
    }
  } finally {
    restore();
  }

  // ---- phase 2: real protocol — these MUST pass ----------------------------
  console.log('\n=== phase 2: real CLAUDE.md (regressions must PASS) ===\n');
  for (const c of REGRESSION_CASES) {
    const r = run(['--case', c, '--runs', String(runs), '--no-stamp']);
    results.real[c] = r.status === 0;
  }

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
  restore();
  console.error('FATAL:', e.stack || e);
  process.exit(1);
});
