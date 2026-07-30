#!/usr/bin/env node
// =============================================================================
// correlate.js — run a case in BOTH lanes and compare the verdicts (EVAL-12).
//
//   The cheap lane only earns its place if it decides cases the same way the
//   expensive one does. This is the check that says so, and it is the gate on
//   SIMP-1's deletions: until it reports ESTABLISHED, deleting the trajectory
//   layer trades a measured suite for an assumed one.
//
//   It does not reimplement the runner. It invokes `evals/run.js --tier 1` and
//   `--tier 2` over the same cases, into a results directory of its own, and
//   compares the rows. Everything that decides a verdict — grading, the
//   cross-checks, gold execution — is therefore literally the same code that
//   runs in a sweep, which is the only way the comparison means anything.
//
//   Two things it deliberately does:
//     - never stamps `last_validated`. A forced-lane run is a measurement of
//       the harness, not a validation of a concept, and it runs each case
//       twice; letting it stamp would put the cheap lane's word on a governed
//       definition.
//     - writes into evals/results/correlation/<ts>/ rather than the main
//       results stream. A forced-tier sweep dropped in beside normal sweeps
//       would be diffed against one by `eval:report`, and every case that
//       changed lane would read as a flip.
//
//   Usage:
//     npm run eval:correlate                     # every case declared tier 1
//     npm run eval:correlate -- --case aov-synonym
//     npm run eval:correlate -- --all            # probe tier-2 cases too
//     npm run eval:correlate -- --from a.jsonl,b.jsonl   # compare, don't run
// =============================================================================
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { loadCases } = require('./lib/cases');
const { correlate, provenanceProblems, CLASS } = require('./lib/correlate');

const RESULTS_DIR = process.env.EVAL_RESULTS_DIR || path.join('evals', 'results');
const CORRELATION_DIR = path.join(RESULTS_DIR, 'correlation');
const RUNNER = path.join(__dirname, 'run.js');

// Observed on real runs (see ROADMAP EVAL-12c) — printed as a warning, never
// used in a calculation.
const OBSERVED = { tier1: '$0.12-0.17', tier2: '$0.20-0.90' };

function parseArgs(argv) {
  const a = { case: null, all: false, runs: 3, quorum: null, model: null, timeout: null, maxTurns: null, from: null, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === '--case') a.case = next();
    else if (k === '--all') a.all = true;
    else if (k === '--runs') a.runs = parseInt(next(), 10);
    else if (k === '--quorum') a.quorum = parseInt(next(), 10);
    else if (k === '--model') a.model = next();
    else if (k === '--timeout') a.timeout = next();
    else if (k === '--max-turns') a.maxTurns = next();
    else if (k === '--from') a.from = next();
    else if (k === '--quiet') a.quiet = true;
    else if (k === '--help' || k === '-h') { printHelp(); process.exit(0); }
    else throw new Error(`unknown flag: ${k}`);
  }
  if (!Number.isFinite(a.runs) || a.runs < 1) throw new Error('--runs must be >= 1');
  if (a.quorum == null) a.quorum = a.runs;
  if (a.quorum > a.runs) throw new Error('--quorum cannot exceed --runs');
  return a;
}

function printHelp() {
  console.log(`
correlation check (EVAL-12) — does tier 1 decide cases the way tier 2 does?

  --case <a,b>     correlate these cases (any declared tier; a tier-2 case is
                   treated as a PROBE for promotion, and never fails the gate)
  --all            correlate every case, not just the ones declared tier 1
  --runs <n>       runs per lane (default 3) — the bill is 2n agent runs/case
  --quorum <n>     passing runs required per lane (default: all of them)
  --model <id>     model for the agent under test, both lanes
  --from <a,b>     compare existing result files instead of running anything
  --quiet          summary only
`);
}

function loadFile(file) {
  const rows = [];
  let meta = null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let o;
    try { o = JSON.parse(t); } catch { continue; }
    if (o.kind === 'run_meta') meta = o;
    else rows.push(o);
  }
  return { file, meta, rows };
}

// Run one lane. Inherits stdio so a 20-minute tier-2 lane is not a silent wait.
// A non-zero exit means cases FAILED, which is data, not an error — only a
// missing results file is fatal.
function runLane(tier, { cases, args, dir }) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(dir, { recursive: true });
    const argv = [RUNNER, '--tier', String(tier), '--runs', String(args.runs),
      '--quorum', String(args.quorum), '--no-stamp'];
    if (cases.length) argv.push('--case', cases.join(','));
    if (args.model) argv.push('--model', args.model);
    if (args.timeout) argv.push('--timeout', args.timeout);
    if (args.maxTurns) argv.push('--max-turns', args.maxTurns);
    if (args.quiet) argv.push('--quiet');

    console.log(`\n=== lane: tier ${tier} =====================================`);
    const child = spawn(process.execPath, argv, {
      stdio: 'inherit',
      env: { ...process.env, EVAL_RESULTS_DIR: dir },
    });
    child.on('error', reject);
    child.on('close', () => {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
      if (!files.length) return reject(new Error(`tier ${tier} produced no results file in ${dir}`));
      resolve(loadFile(path.join(dir, files[files.length - 1])));
    });
  });
}

const usd = (n) => (n ? `$${n.toFixed(2)}` : '—');
const lane = (v) => (v.present
  ? `${v.passed}/${v.total}${v.flaky ? ' flaky' : ''}`
  : v.errored ? `${v.errored} err` : 'absent');

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const all = loadCases();
  const broken = all.filter((c) => c.errors && c.errors.length);
  if (broken.length) {
    console.error('\nCORRELATION FAILED — invalid case files:');
    for (const c of broken) c.errors.forEach((e) => console.error(`  ${c._path}: ${e}`));
    process.exit(1);
  }
  const declared = Object.fromEntries(all.map((c) => [c.name, c.tier]));

  let bundle;
  let outDir = null;

  if (args.from) {
    const files = args.from.split(',').map((s) => s.trim()).filter(Boolean);
    const loaded = files.map(loadFile);
    const problems = loaded.length === 2 ? provenanceProblems(loaded[0].meta, loaded[1].meta) : [];
    bundle = {
      rows: loaded.flatMap((l) => l.rows),
      metas: loaded.map((l) => l.meta),
      problems,
      sources: files,
    };
  } else {
    // Which cases. Default: exactly the ones whose sweep verdict RESTS on the
    // cheap lane. Everything else is opt-in, because tier-2 runs are the bill.
    const selected = args.case
      ? args.case.split(',').map((s) => s.trim()).filter(Boolean)
      : all.filter((c) => args.all || c.tier === 1).map((c) => c.name);
    for (const n of selected)
      if (!declared.hasOwnProperty(n)) throw new Error(`no such eval case: ${n}`);

    if (!selected.length) {
      console.log('No case declares tier 1 — nothing to correlate.');
      console.log('(Use --all to probe whether any tier-2 case could be promoted.)');
      process.exit(0);
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
    outDir = path.join(CORRELATION_DIR, stamp);

    console.log(`Correlation check: ${selected.length} case(s) x ${args.runs} run(s) x 2 lanes`);
    console.log(`  cases: ${selected.join(', ')}`);
    console.log(`  ${selected.length * args.runs} tier-1 runs (observed ${OBSERVED.tier1} each) + ` +
      `${selected.length * args.runs} tier-2 runs (observed ${OBSERVED.tier2} each)`);
    console.log(`  results: ${outDir}`);

    const t1 = await runLane(1, { cases: selected, args, dir: path.join(outDir, 'tier1') });
    const t2 = await runLane(2, { cases: selected, args, dir: path.join(outDir, 'tier2') });
    bundle = {
      rows: [...t1.rows, ...t2.rows],
      metas: [t1.meta, t2.meta],
      problems: provenanceProblems(t1.meta, t2.meta),
      sources: [t1.file, t2.file],
    };
  }

  const report = correlate(bundle.rows, { quorum: args.quorum, declared, problems: bundle.problems });

  // ---- print ----------------------------------------------------------------
  console.log('');
  console.log('=== correlation ==============================================');
  console.log(`${'case'.padEnd(32)} ${'decl'.padEnd(5)} ${'tier1'.padEnd(11)} ${'tier2'.padEnd(11)} class`);
  for (const c of report.cases) {
    console.log(
      `${c.case.padEnd(32)} ${String(c.declared_tier).padEnd(5)} ` +
      `${lane(c.tier1).padEnd(11)} ${lane(c.tier2).padEnd(11)} ${c.class}${c.probe ? ' (probe)' : ''}`);
    if (c.class !== CLASS.AGREE_PASS || c.probe) console.log(`    ${c.note}`);
    // A shared verdict reached at different strengths is worth seeing even when
    // the case agrees: `exact` in one lane and `subset` in the other passes
    // today and is the pair most likely to diverge next.
    const m1 = c.tier1.match_tiers || [], m2 = c.tier2.match_tiers || [];
    if (m1.length && m2.length && m1.join() !== m2.join())
      console.log(`    match strength differs: tier 1 ${m1.join('/')} vs tier 2 ${m2.join('/')}`);
    if (c.tier1.reasons.length || c.tier2.reasons.length)
      console.log(`    failed on: tier 1 [${c.tier1.reasons.join(', ') || '—'}] vs tier 2 [${c.tier2.reasons.join(', ') || '—'}]`);
  }

  const s = report.summary;
  console.log('');
  console.log(`Cost: tier 1 ${usd(s.cost.tier1)} vs tier 2 ${usd(s.cost.tier2)}` +
    (s.cost.tier1 && s.cost.tier2 ? ` — ${(s.cost.tier2 / s.cost.tier1).toFixed(1)}x` : ''));
  if (s.probes) console.log(`Probes: ${s.probes} tier-2 case(s) tried cheap${s.promotable.length ? ` — promotable: ${s.promotable.join(', ')}` : ' — none promotable'}`);

  if (bundle.problems.length) {
    console.log('');
    console.log('PROVENANCE PROBLEM — the two lanes are not comparable:');
    for (const p of bundle.problems) console.log(`  ${p}`);
  }

  console.log('');
  console.log(`VERDICT: ${s.verdict}` +
    (s.verdict === 'INVALID' ? '' : ` — ${s.established}/${s.correlated} tier-1 case(s) confirmed by tier 2`));
  if (s.false_green.length) console.log(`  FALSE GREEN (the dangerous direction): ${s.false_green.join(', ')}`);
  if (s.false_red.length) console.log(`  FALSE RED: ${s.false_red.join(', ')}`);
  if (s.inconclusive.length) console.log(`  inconclusive (nothing proved): ${s.inconclusive.join(', ')}`);
  if (s.verdict === 'ESTABLISHED')
    console.log('  The cheap lane reproduces the expensive lane on every case that relies on it.');
  else if (s.verdict === 'INVALID')
    console.log('  Nothing was compared — fix the provenance problem above and re-run.');
  else
    console.log('  Until this reads ESTABLISHED, SIMP-1 must not delete the trajectory layer.');

  // ---- persist --------------------------------------------------------------
  const record = {
    kind: 'correlation',
    ts: new Date().toISOString(),
    runs: args.runs,
    quorum: args.quorum,
    sources: bundle.sources,
    provenance_problems: bundle.problems,
    semantic_identity: bundle.metas[0] && bundle.metas[0].semantic_identity || null,
    ...report,
  };
  const dir = outDir || CORRELATION_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, outDir ? 'correlation.json'
    : `${new Date().toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z')}-correlation.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n');
  console.log(`\nRecord: ${file}`);

  // Exit 0 means one thing only: the proxy is validated. Anything else — a
  // disagreement, a case both lanes failed, a comparison that could not be made
  // — leaves the cheap lane unproven, and "unproven" must never read as "fine".
  // A provenance problem is the worst of them: no comparison happened at all.
  process.exit(!bundle.problems.length && s.verdict === 'ESTABLISHED' ? 0 : 1);
})().catch((e) => { console.error('FATAL:', e.stack || e); process.exit(1); });
