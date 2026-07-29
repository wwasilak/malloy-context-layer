#!/usr/bin/env node
// =============================================================================
// gold.js — compute gold values from each case's gold_query and commit them
//           into the case file.
//
//   "Do NOT hand-type numbers." A gold value is only trustworthy if the query
//   that produced it is stored next to it, so this is the only writer of
//   expect_value: run the blessed query against the fixtures, write the scalar
//   back into the frontmatter, and the pair stays auditable and regenerable.
//
//   It also EXECUTES the gold_query of every non-numeric case. A gold query
//   that no longer compiles is a broken case, and it is much cheaper to learn
//   that here than to watch a sweep of agent runs fail for a reason that has
//   nothing to do with the agent.
//
//   --check is the read-only form, and it is now the SAME code the build gate
//   runs (goldcheck.js, SIMP-4) rather than a second implementation of it.
//   Kept as a command because it is useful standalone — `--live`, or one case
//   at a time, without a full build.
//
//   Usage: npm run eval:gold [-- --case <name>] [-- --check]
// =============================================================================
const path = require('path');
const { loadCases, EVALS_DIR } = require('./lib/cases');
const mal = require('./lib/malloy');
const { checkGold } = require('./lib/goldcheck');
const { setFrontmatterField } = require('./lib/stamp');

(async () => {
  const argv = process.argv.slice(2);
  let only = null;
  let check = false;       // verify only: never write (for CI)
  let live = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--case') only = argv[++i];
    else if (argv[i] === '--check') check = true;
    else if (argv[i] === '--live') live = true;
    else throw new Error(`unknown flag: ${argv[i]}`);
  }

  const workdir = mal.workdirFor(live ? 'live' : 'fixtures');
  const index = await mal.buildSourceIndex(workdir);

  // --check is read-only and shared with the build gate.
  if (check) {
    const { lines, problems } = await checkGold({ workdir, index, only });
    lines.forEach((l) => console.log('  ' + l));
    problems.forEach((p) => console.error('  FAIL   ' + p));
    console.log('');
    console.log(`Gold check: ${problems.length ? problems.length + ' problem(s)' : 'all gold values current'}`);
    process.exit(problems.length ? 1 : 0);
  }

  const cases = loadCases(undefined, only);
  const broken = cases.filter((c) => c.errors && c.errors.length);
  if (broken.length) {
    console.error('\nInvalid case files:');
    for (const c of broken) c.errors.forEach((e) => console.error(`  ${c._path}: ${e}`));
    process.exit(1);
  }

  let written = 0;
  let failures = 0;

  for (const c of cases) {
    if (!c.gold_runs.length) {
      console.log(`  skip   ${c.name} — no gold_query`);
      continue;
    }

    // every gold statement must run, whatever the case grades on
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
      console.error(`  BROKEN ${c.name} — gold_query failed: ${err}`);
      failures++;
      continue;
    }

    if (c.expect_kind !== 'numeric') {
      console.log(`  ok     ${c.name} — ${results.length} gold query(s) run, ${results[0].rows.length} row(s) [${c.expect_kind}]`);
      continue;
    }

    const value = mal.scalarFrom(results[0].rows);
    if (value == null) {
      console.error(`  BROKEN ${c.name} — gold_query for a numeric case must return exactly one row with one numeric column`);
      failures++;
      continue;
    }

    const file = path.join(EVALS_DIR, `${c.name}.md`);
    if (setFrontmatterField(file, 'expect_value', String(value))) {
      console.log(`  wrote  ${c.name} — expect_value: ${value}`);
      written++;
    } else {
      console.log(`  ok     ${c.name} — ${value} (unchanged)`);
    }
  }

  console.log('');
  console.log(check
    ? `Gold check: ${failures ? failures + ' problem(s)' : 'all gold values current'}`
    : `Gold: ${written} case file(s) updated`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FATAL:', e.stack || e); process.exit(1); });
