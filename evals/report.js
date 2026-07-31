#!/usr/bin/env node
// =============================================================================
// report.js — EVAL-3: diff the two most recent result files.
//
//   The runner tells you the current pass rate. This tells you what MOVED, and
//   that is the actual product of the loop: a case that flipped pass -> fail
//   between two runs is the signal a definition change just broke an answer.
//
//   The semantic identity (EVAL-6) makes each flip diagnosable:
//     identity unchanged -> the data moved, or the agent was non-deterministic
//     identity changed   -> a kp/, models/ or CLAUDE.md edit moved the meaning
//
//   Usage: npm run eval:report [-- --last <n>]
// =============================================================================
const fs = require('fs');
const path = require('path');

const { isResultRow } = require('./lib/select');

const RESULTS_DIR = process.env.EVAL_RESULTS_DIR || path.join('evals', 'results');

function loadRun(file) {
  const rows = [];
  let meta = null;
  let selection = null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let o;
    try { o = JSON.parse(t); } catch { continue; }
    if (o.kind === 'run_meta') meta = o;
    else if (o.kind === 'selection') selection = o;
    else if (isResultRow(o)) rows.push(o);
  }

  // case-level verdict = quorum of its runs, the same rule run.js applied
  const byCase = {};
  for (const r of rows) {
    const c = (byCase[r.case] ||= { case: r.case, category: r.category, passed: 0, total: 0, details: [] });
    c.total++;
    if (r.pass) c.passed++;
    else c.details.push(r.grade_detail);
  }
  const quorum = (meta && meta.quorum) || null;
  for (const c of Object.values(byCase)) c.pass = c.passed >= (quorum || c.total);

  return { file, meta, rows, cases: byCase, selection };
}

// Cases the sweep chose not to re-measure (EVAL-12b). Absent from the rows by
// design, so without this they read as GONE — a flip that never happened, which
// is the false signal this report exists to avoid producing.
const skippedNames = (run) =>
  new Set(((run.selection && run.selection.skipped) || []).map((s) => s.case));

function recentFiles(n) {
  if (!fs.existsSync(RESULTS_DIR)) return [];
  return fs.readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .slice(-n)
    .map((f) => path.join(RESULTS_DIR, f));
}

const pct = (p, n) => (n === 0 ? '—' : `${Math.round((p / n) * 100)}%`);

(async () => {
  const argv = process.argv.slice(2);
  let last = 2;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--last') last = parseInt(argv[++i], 10);
    else throw new Error(`unknown flag: ${argv[i]}`);
  }

  const files = recentFiles(last);
  if (!files.length) {
    console.error(`no result files in ${RESULTS_DIR} — run 'npm run eval' first`);
    process.exit(1);
  }

  const runs = files.map(loadRun);
  const curr = runs[runs.length - 1];
  const prev = runs.length > 1 ? runs[runs.length - 2] : null;

  console.log(`Current: ${path.basename(curr.file)}`);
  if (curr.meta) {
    console.log(`  model ${curr.meta.model_id} | data ${curr.meta.data_source} | quorum ${curr.meta.quorum}/${curr.meta.runs}`);
    console.log(`  identity ${String(curr.meta.semantic_identity).slice(0, 30)}…`);
  }

  // ---- pass rate by category ------------------------------------------------
  const cats = {};
  for (const c of Object.values(curr.cases)) {
    (cats[c.category] ||= { p: 0, n: 0 });
    cats[c.category].n++;
    if (c.pass) cats[c.category].p++;
  }
  const total = Object.values(curr.cases).length;
  const passed = Object.values(curr.cases).filter((c) => c.pass).length;

  console.log('');
  console.log(`Pass rate: ${passed}/${total} (${pct(passed, total)})`);
  for (const [cat, v] of Object.entries(cats).sort())
    console.log(`  ${cat.padEnd(16)} ${v.p}/${v.n}  ${pct(v.p, v.n)}`);

  // flakiness is worth surfacing on its own: a case that passed 2 of 3 runs is
  // not a healthy case even when the quorum let it through
  const flaky = Object.values(curr.cases).filter((c) => c.passed > 0 && c.passed < c.total);
  if (flaky.length) {
    console.log('');
    console.log('Non-deterministic (passed some runs, not all):');
    for (const c of flaky) console.log(`  ${c.case}  ${c.passed}/${c.total}`);
  }

  // ---- flips ---------------------------------------------------------------
  if (!prev) {
    console.log('\n(only one result file — no comparison yet)');
    process.exit(0);
  }

  console.log('');
  console.log(`Compared with: ${path.basename(prev.file)}`);

  const identityChanged = curr.meta && prev.meta &&
    curr.meta.semantic_identity !== prev.meta.semantic_identity;
  const dataChanged = curr.meta && prev.meta && curr.meta.data_source !== prev.meta.data_source;

  const currSkipped = skippedNames(curr);
  const prevSkipped = skippedNames(prev);
  const names = new Set([...Object.keys(curr.cases), ...Object.keys(prev.cases)]);
  const broke = [], fixed = [], added = [], removed = [], notRun = [];
  for (const n of [...names].sort()) {
    const a = prev.cases[n], b = curr.cases[n];
    if (currSkipped.has(n) || prevSkipped.has(n)) { notRun.push(n); continue; }
    if (!a) { added.push(n); continue; }
    if (!b) { removed.push(n); continue; }
    if (a.pass && !b.pass) broke.push(b);
    if (!a.pass && b.pass) fixed.push(b);
  }

  if (broke.length) {
    console.log('\n  REGRESSED (pass -> fail):');
    for (const c of broke) console.log(`    ${c.case} [${c.category}] — ${c.details[0] || ''}`);
  }
  if (fixed.length) {
    console.log('\n  RECOVERED (fail -> pass):');
    for (const c of fixed) console.log(`    ${c.case} [${c.category}]`);
  }
  if (added.length) console.log(`\n  NEW cases: ${added.join(', ')}`);
  if (removed.length) console.log(`  GONE cases: ${removed.join(', ')}`);
  if (notRun.length)
    console.log(`  NOT COMPARED (skipped by impact selection in one of the runs): ${notRun.join(', ')}`);
  if (!broke.length && !fixed.length && !added.length && !removed.length)
    console.log('  no flips');

  // ---- the diagnosis (EVAL-6) ----------------------------------------------
  if (broke.length || fixed.length) {
    console.log('');
    if (identityChanged)
      console.log('  Semantic identity CHANGED between these runs — a kp/, models/ or CLAUDE.md');
    else if (dataChanged)
      console.log('  Semantic identity unchanged but the data source differs — the DATA moved.');
    else
      console.log('  Semantic identity and data source both unchanged — no definition moved;');
    if (identityChanged)
      console.log('  edit moved the MEANING. Expect number changes; confirm they were intended.');
    else if (!dataChanged)
      console.log('  suspect agent non-determinism, and check the flaky list above.');
  }

  process.exit(broke.length ? 1 : 0);
})().catch((e) => { console.error('FATAL:', e.stack || e); process.exit(1); });
