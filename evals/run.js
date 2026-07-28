#!/usr/bin/env node
// =============================================================================
// run.js — EVAL-1: the eval runner.
//
//   Loop every case in kp/agent/evals/ through the agent under test, grade the
//   answer AND the route it took, and write a provenance-stamped result row per
//   (case x run). Exits non-zero on any failing case so CI can gate on it.
//
//   Why N runs. The thing under test is stochastic; a single green run proves
//   very little and a single red one is as likely to be noise as a regression.
//   A case passes only if it passes on a quorum of runs, and every individual
//   run is recorded so a flaky case is visibly flaky rather than silently
//   alternating between green and red on successive builds.
//
//   Usage:
//     npm run eval
//     npm run eval -- --case aov-synonym
//     npm run eval -- --live
//     npm run eval -- --model claude-opus-5 --runs 3
// =============================================================================
const fs = require('fs');
const path = require('path');

const { loadCases } = require('./lib/cases');
const mal = require('./lib/malloy');
const { ask, AGENT_BIN } = require('./lib/agent');
const { grade } = require('./lib/grade');
const { semanticIdentity } = require('./lib/identity');
const { setFrontmatterField } = require('./lib/stamp');
const okf = require('../okf-lib');

const KP_DIR = process.env.KP_DIR || 'kp';
const RESULTS_DIR = process.env.EVAL_RESULTS_DIR || path.join('evals', 'results');

// ---- CLI --------------------------------------------------------------------
function parseArgs(argv) {
  const a = {
    case: null, live: false, model: null, runs: 3, quorum: null,
    timeout: 300000, stamp: !process.env.CI, maxTurns: 30, rowLimit: 200, quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === '--case') a.case = next();
    else if (k === '--live') a.live = true;
    else if (k === '--model') a.model = next();
    else if (k === '--runs') a.runs = parseInt(next(), 10);
    else if (k === '--quorum') a.quorum = parseInt(next(), 10);
    else if (k === '--timeout') a.timeout = parseInt(next(), 10) * 1000;
    else if (k === '--max-turns') a.maxTurns = parseInt(next(), 10);
    else if (k === '--stamp') a.stamp = true;
    else if (k === '--no-stamp') a.stamp = false;
    else if (k === '--quiet') a.quiet = true;
    else if (k === '--help' || k === '-h') { printHelp(); process.exit(0); }
    else throw new Error(`unknown flag: ${k}`);
  }
  if (!Number.isFinite(a.runs) || a.runs < 1) throw new Error('--runs must be >= 1');
  // default: unanimity. A case that only passes sometimes is not passing.
  if (a.quorum == null) a.quorum = a.runs;
  if (a.quorum > a.runs) throw new Error('--quorum cannot exceed --runs');
  return a;
}

function printHelp() {
  console.log(`
eval runner (EVAL-1)

  --case <name>      run one case (file basename, no .md)
  --live             run against EVAL_LIVE_WORKDIR instead of committed fixtures
  --model <id>       model for the agent under test (recorded in results)
  --runs <n>         runs per case (default 3)
  --quorum <n>       passing runs required (default: all of them)
  --timeout <sec>    per-run timeout (default 300)
  --max-turns <n>    agent turn cap (default 30)
  --no-stamp         do not write last_validated (implied when CI is set)
  --quiet            summary only
`);
}

// ---- helpers ----------------------------------------------------------------
const pct = (n, d) => (d === 0 ? '—' : `${Math.round((n / d) * 100)}%`);
const today = () => new Date().toISOString().slice(0, 10);
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');

// ---- main -------------------------------------------------------------------
(async () => {
  const args = parseArgs(process.argv.slice(2));

  const cases = loadCases(undefined, args.case);
  const broken = cases.filter((c) => c.errors && c.errors.length);
  if (broken.length) {
    console.error('\nEVAL FAILED — invalid case files:');
    for (const c of broken) c.errors.forEach((e) => console.error(`  ${c._path}: ${e}`));
    process.exit(1);
  }
  if (!cases.length) { console.error('no eval cases found'); process.exit(1); }

  // data + models
  const mode = args.live ? 'live' : 'fixtures';
  const workdir = mal.workdirFor(mode);
  const index = await mal.buildSourceIndex(workdir);
  const versions = mal.runtimeVersions();
  const ctx = { runQuery: (q) => mal.runQuery(q, { workdir, index, rowLimit: args.rowLimit }) };

  // provenance (EVAL-6)
  const ident = semanticIdentity({ kpDir: KP_DIR, modelsDir: mal.MODELS_DIR, runtimeSettings: versions });

  // data_source: fixtures identified by content, live by how far the data goes
  let dataSource = `${mode}@unknown`;
  try {
    if (mode === 'fixtures') {
      const { treeDigest } = require('./lib/identity');
      dataSource = `fixtures@${treeDigest('ParquetFiles').slice(0, 12)}`;
    } else {
      dataSource = `live@${workdir}`;
    }
  } catch { /* non-fatal: provenance detail, not a gate */ }

  console.log(`Eval: ${cases.length} case(s) x ${args.runs} run(s), quorum ${args.quorum}/${args.runs}`);
  console.log(`Agent: ${AGENT_BIN}${args.model ? ' (' + args.model + ')' : ''} | data: ${dataSource}`);
  console.log(`Semantic identity: ${ident.semantic_identity.slice(0, 23)}…${ident.components.dirty ? ' (working tree dirty)' : ''}`);
  console.log('');

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const outFile = path.join(RESULTS_DIR, `${stamp()}.jsonl`);
  const out = fs.createWriteStream(outFile);
  const write = (o) => out.write(JSON.stringify(o) + '\n');

  write({
    kind: 'run_meta', ts: new Date().toISOString(), cases: cases.length, runs: args.runs,
    quorum: args.quorum, model_id: args.model || 'default', agent: AGENT_BIN,
    data_source: dataSource, semantic_identity: ident.semantic_identity,
    identity_components: ident.components, runtime: versions,
  });

  // gold values: prefer the number committed in the case file; compute in
  // memory when it is missing so the loop is usable before `eval:gold` has been
  // run, but record WHICH so an unaudited gold is never mistaken for a blessed
  // one.
  for (const c of cases) {
    c._gold_source = 'case-file';
    if (c.expect_kind === 'numeric' && c.expect_value == null && c.gold_runs.length) {
      try {
        const r = await ctx.runQuery(c.gold_runs[0]);
        const v = mal.scalarFrom(r.rows);
        if (v != null) {
          c.expect_value = v;
          c._gold_source = 'computed-at-runtime';
        }
      } catch (e) {
        console.warn(`  WARN ${c.name}: gold_query failed — ${e.message || e}`);
      }
    }
  }

  const caseResults = [];
  for (const c of cases) {
    const runs = [];
    for (let i = 1; i <= args.runs; i++) {
      const res = await ask({
        question: c.question, model: args.model,
        maxTurns: args.maxTurns, timeoutMs: args.timeout,
      });
      let g;
      try {
        g = await grade(c, res, ctx);
      } catch (e) {
        g = { pass: false, detail: `grader error: ${e.message || e}`, extracted: null, receipt_present: false };
      }
      runs.push(g.pass);

      write({
        ts: new Date().toISOString(),
        case: c.name,
        category: c.category,
        run: i,
        pass: g.pass,
        expect_kind: c.expect_kind,
        grade_detail: g.detail,
        agent_answer_excerpt: String(res.answer || '').slice(0, 1200),
        executed_malloy: (res.executedMalloy || []).join('\n---\n').slice(0, 4000),
        extracted_value: g.extracted,
        expect_value: c.expect_value,
        gold_source: c._gold_source,
        receipt_present: g.receipt_present,
        must_use: c.must_use,
        tool_calls: (res.toolCalls || []).length,
        malloy_tool_calls: res.malloy_tool_calls ?? null,
        tokens: res.tokens,
        cost_usd: res.cost_usd ?? null,
        latency_ms: res.latency_ms,
        num_turns: res.num_turns ?? null,
        agent_error: res.error || null,
        semantic_identity: ident.semantic_identity,
        model_id: args.model || 'default',
        runtime: `${AGENT_BIN} | malloy ${versions.malloy} | duckdb ${versions.duckdb}`,
        data_source: dataSource,
      });

      if (!args.quiet)
        console.log(`  ${g.pass ? 'PASS' : 'FAIL'}  ${c.name} [${i}/${args.runs}] — ${g.detail}`);
    }

    const passed = runs.filter(Boolean).length;
    const casePass = passed >= args.quorum;
    caseResults.push({ name: c.name, category: c.category, pass: casePass, passed, total: args.runs, must_use: c.must_use });
    console.log(`${casePass ? 'PASS' : 'FAIL'}  ${c.name} (${passed}/${args.runs})`);
  }

  // Wait for the flush. process.exit() below would otherwise discard whatever
  // is still buffered, and a truncated results file is worse than none: the
  // report would read it as cases that silently vanished.
  await new Promise((resolve, reject) => {
    out.on('finish', resolve);
    out.on('error', reject);
    out.end();
  });

  // ---- last_validated stamping (EVAL-3) ------------------------------------
  // ARCHITECTURE.md documents this field as eval-runner-stamped; this is the
  // writer. A concept is only stamped when a case that must_use it passed on
  // this run — the date means "a governed answer through this concept was
  // verified", not "someone looked at it".
  let stamped = 0;
  if (args.stamp) {
    const bundle = okf.loadBundle(KP_DIR);
    const validated = new Set();
    for (const r of caseResults) if (r.pass) r.must_use.forEach((u) => validated.add(u));
    for (const uri of validated) {
      const c = bundle.canon[uri];
      if (!c) { console.warn(`  WARN must_use references unknown concept: ${uri}`); continue; }
      if (setFrontmatterField(path.join(KP_DIR, c._path), 'last_validated', today())) stamped++;
    }
  }

  // ---- summary --------------------------------------------------------------
  const passedCases = caseResults.filter((c) => c.pass).length;
  const byCat = {};
  for (const r of caseResults) {
    (byCat[r.category] ||= { p: 0, n: 0 });
    byCat[r.category].n++;
    if (r.pass) byCat[r.category].p++;
  }

  console.log('');
  console.log(`Cases: ${passedCases}/${caseResults.length} passed (${pct(passedCases, caseResults.length)})`);
  for (const [cat, v] of Object.entries(byCat).sort())
    console.log(`  ${cat.padEnd(16)} ${v.p}/${v.n}`);
  if (args.stamp) console.log(`last_validated stamped on ${stamped} concept file(s)`);
  console.log(`Results: ${outFile}`);

  const unaudited = cases.filter((c) => c._gold_source === 'computed-at-runtime');
  if (unaudited.length)
    console.log(`\nNote: gold computed at runtime for ${unaudited.map((c) => c.name).join(', ')} — run 'npm run eval:gold' to commit those numbers.`);

  process.exit(passedCases === caseResults.length ? 0 : 1);
})().catch((e) => { console.error('FATAL:', e.stack || e); process.exit(1); });
