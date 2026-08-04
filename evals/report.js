#!/usr/bin/env node
// =============================================================================
// report.js — SIMP-2: print the views in evals/results.malloy.
//
//   This used to be 172 lines of hand-rolled grouping and diffing over JSONL.
//   The harness writes JSONL, DuckDB reads JSONL natively, and we own a
//   semantic layer — so the grouping moved to `evals/results.malloy` and what
//   is left here is a printer.
//
//   The deletion is not the only point. The old reporter re-implemented the
//   quorum rule alongside run.js, so "what counts as a passing run" was
//   written twice and could drift; now `passed` and `completed` are measures
//   defined once. It also silently mis-scored every row written before EVAL-14
//   added `errored`, because `errored = false` is NULL on those rows — the
//   model's `answered` dimension is where that is handled, once.
//
//   Anything this does not print is one query away:
//     npm run eval:report -- --view cost_by_case
//   and the model is a first-class Malloy surface, so the agent can analyse
//   its own eval history with the tool under test.
//
//   Usage: npm run eval:report [-- --view <name>]
// =============================================================================
const path = require('path');
const mal = require('../malloy-lib');

const MODEL = path.join('evals', 'results.malloy');
const num = (v) => (typeof v === 'bigint' ? Number(v) : v);
const pct = (v) => (v == null ? '—' : `${Math.round(Number(v) * 100)}%`);
const usd = (v) => (v == null ? '—' : `$${Number(v).toFixed(2)}`);

const view = async (name) => {
  const r = await mal.runQueryIn(MODEL, `run: eval_case_runs -> ${name}`,
    { workdir: process.cwd(), rowLimit: 500 });
  return r.rows;
};

(async () => {
  const argv = process.argv.slice(2);
  let only = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--view') only = argv[++i];
    else throw new Error(`unknown flag: ${argv[i]}`);
  }

  // Ad-hoc mode: dump any view in the model. This is the escape hatch that
  // stops the next question from becoming another throwaway script.
  if (only) {
    const rows = await view(only);
    console.log(JSON.stringify(rows, (k, v) => num(v), 2));
    process.exit(0);
  }

  const sweeps = await view('sweeps');
  if (!sweeps.length) {
    console.error(`no result rows found — run 'npm run eval' first`);
    process.exit(1);
  }

  // `sweeps` spans every stream on purpose, so the newest row is often a
  // selftest or correlation run rather than a sweep. Say which — labelling a
  // selftest "Latest sweep" invites reading a deliberate failure as a result.
  const [latest] = sweeps;
  console.log(`Latest run: ${latest.sweep} [${latest.stream}]`);
  console.log(`  ${latest.case_runs} run(s), ${latest.passed} passed, ` +
    `${usd(latest.cost)}${latest.never_answered ? `, ${latest.never_answered} never answered` : ''}`);

  const prov = (await view('provenance')).filter((p) => p.sweep === latest.sweep);
  for (const p of prov)
    console.log(`  identity ${String(p.semantic_identity).slice(0, 30)}… | data ${p.data_source} | model ${p.model_id}`);

  console.log('\nPass rate by case (all sweeps):');
  for (const c of await view('by_case'))
    console.log(`  ${String(c.case_name).padEnd(32)} ${c.passed}/${c.completed ?? c.case_runs}  ${pct(c.pass_rate)}  ${usd(c.cost)}`);

  console.log('\nBy category:');
  for (const c of await view('by_category'))
    console.log(`  ${String(c.category).padEnd(18)} ${c.passed}/${c.case_runs}  ${pct(c.pass_rate)}`);

  const flaky = await view('flaky');
  if (flaky.length) {
    console.log('\nNon-deterministic (passed some runs, not all):');
    for (const c of flaky) console.log(`  ${String(c.case_name).padEnd(32)} ${pct(c.pass_rate)}`);
  }

  // ---- flips ----------------------------------------------------------------
  // `flips` nests each case's sweep history, with lag() partitioned by case.
  // All this does is read the last entry and say whether it moved.
  const broke = [], fixed = [];
  for (const c of await view('flips')) {
    const h = c.history || [];
    const last = h[h.length - 1];
    if (!last || last.previously_passed == null) continue;
    const was = Number(last.previously_passed), now = Number(last.passed);
    if (was > 0 && now === 0) broke.push(`${c.case_name} (${was} → ${now} passing, ${last.sweep})`);
    else if (was === 0 && now > 0) fixed.push(`${c.case_name} (${was} → ${now} passing, ${last.sweep})`);
  }
  console.log('');
  if (broke.length) {
    console.log('  REGRESSED (was passing, now not):');
    for (const b of broke) console.log(`    ${b}`);
  }
  if (fixed.length) {
    console.log('  RECOVERED:');
    for (const f of fixed) console.log(`    ${f}`);
  }
  if (!broke.length && !fixed.length) console.log('  no flips between a case\'s last two sweeps');

  console.log(`\nEvery view: ${(await view('by_lane')).map((l) => `${l.lane} ${pct(l.pass_rate)}`).join(' | ')}`);
  console.log(`More: npm run eval:report -- --view <by_case|by_category|by_lane|flaky|sweeps|cost_by_case|provenance|flips>`);

  process.exit(broke.length ? 1 : 0);
})().catch((e) => { console.error('FATAL:', e.stack || e); process.exit(1); });
