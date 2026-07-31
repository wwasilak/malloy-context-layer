// =============================================================================
// unit.test.js — the fast, no-database net under the harness's pure functions.
//
//   Scope on purpose: parsing, comparison and path handling only. Anything that
//   needs DuckDB is covered by `npm run eval:check` (gold queries actually run)
//   and `npm run eval:selftest` (protocol behaviour). This file must stay fast
//   enough that there is never a reason to skip it.
//
//   Why it exists: the EVAL-8 dirty-flag bug shipped under a full set of
//   passing checks, because those checks exercised treeDigest and never the
//   flag. The lesson is not "write more tests" — it is that a function worth
//   extracting is worth pinning, especially the string-munging ones where a
//   single dropped character reads as correct. Every case below is a bug that
//   was either found in review or is one refactor away from returning.
//
//   Run: npm test
// =============================================================================
const test = require('node:test');
const assert = require('node:assert');

const { porcelainPaths } = require('../evals/lib/identity');
const {
  compareResults, containsAll, stripImports, referencedSource, resolveModelFor,
} = require('../evals/lib/malloy');
const { definedIn, listModelFiles } = require('../malloy-lib');
const {
  parseJsonBlock, toRun, buildPrompt, buildRepairPrompt, addUsage, sumTokens, askTier1,
} = require('../evals/lib/tier1');
const { transportErrorOf } = require('../evals/lib/agent');
const { loadCase, DEFAULT_TIER } = require('../evals/lib/cases');
const {
  correlate, classify, laneVerdict, verdictFor, reasonKey, provenanceProblems, CLASS,
} = require('../evals/lib/correlate');
const {
  planeContext, caseFingerprint, selectCases, evidenceKey, isResultRow, surfaceDigest,
  conceptDeps,
} = require('../evals/lib/select');
const { runPool, serialize } = require('../evals/lib/pool');

// ---- porcelainPaths (EVAL-8 regression) -------------------------------------
// `git status --porcelain` emits `XY PATH`. X or Y is very often a space, so
// trimming the whole output before splitting silently eats one character of the
// FIRST path only — which is exactly how the original bug hid.
test('porcelainPaths keeps the leading status column of the first line', () => {
  const out = ' M kp/sales/average-order-value.md\n M kp/global/margin.md\n';
  assert.deepStrictEqual(porcelainPaths(out), [
    'kp/sales/average-order-value.md',
    'kp/global/margin.md',
  ]);
});

test('porcelainPaths handles staged, modified-both and untracked statuses', () => {
  const out = 'M  kp/a.md\nMM kp/b.md\n?? kp/c.md\nA  kp/d.md\n';
  assert.deepStrictEqual(porcelainPaths(out), ['kp/a.md', 'kp/b.md', 'kp/c.md', 'kp/d.md']);
});

test('porcelainPaths takes the destination of a rename', () => {
  const out = 'R  kp/old-name.md -> kp/new-name.md\n';
  assert.deepStrictEqual(porcelainPaths(out), ['kp/new-name.md']);
});

test('porcelainPaths unquotes paths with spaces', () => {
  const out = ' M "kp/sales/two words.md"\n';
  assert.deepStrictEqual(porcelainPaths(out), ['kp/sales/two words.md']);
});

test('porcelainPaths returns nothing for a clean tree', () => {
  assert.deepStrictEqual(porcelainPaths(''), []);
  assert.deepStrictEqual(porcelainPaths('\n'), []);
});

// ---- compareResults / containsAll (EVAL-9 regression) -----------------------
// The original containment compared flattened value multisets, so a gold scalar
// passed against any result that happened to contain that number anywhere.
test('compareResults: identical rows are exact', () => {
  const rows = [{ year: 2023, total_sales: 100 }];
  assert.strictEqual(compareResults(rows, rows), 'exact');
});

test('compareResults: same numbers under different column names are values', () => {
  const agent = [{ category_margin: 42 }];
  const gold = [{ margin: 42 }];
  assert.strictEqual(compareResults(agent, gold), 'values');
});

test('compareResults: extra COLUMNS alongside the gold table are subset', () => {
  const agent = [{ active_customers: 31576, total_customers: 40000 }];
  const gold = [{ active_customers: 31576 }];
  assert.strictEqual(compareResults(agent, gold), 'subset');
});

test('compareResults: extra ROWS are NOT containment (the EVAL-9 hole)', () => {
  // A gold scalar padded out with unrelated rows: a different row count is a
  // different grain or a missing filter, which is a different answer.
  const padded = [{ active_customers: 31576 }];
  for (let i = 0; i < 50; i++) padded.push({ active_customers: 1000 + i });
  assert.strictEqual(compareResults(padded, [{ active_customers: 31576 }]), 'none');
});

test('compareResults: a gold value appearing in an unrelated column is not a match', () => {
  // Same row count, so EVAL-9's row guard does not catch this one: the rename
  // search must refuse an assignment it has no evidence for.
  const agent = [{ order_count: 47, total_sales: 900 }];
  const gold = [{ active_customers: 47 }];
  assert.strictEqual(compareResults(agent, gold), 'none');
});

test('compareResults: an aliased column IS matched when anchored by a shared name', () => {
  // The real aov-synonym run 3: gold's column is present by name, and the agent
  // returned the denominators next to it.
  const agent = [{ average_order_value: 12.5, total_sales: 100, order_count: 8 }];
  const gold = [{ average_order_value: 12.5 }];
  assert.strictEqual(compareResults(agent, gold), 'subset');
});

test('compareResults: an unanchored rename is matched once it must hold across rows', () => {
  const agent = [{ cat: 'a', category_margin: 1, extra: 9 }, { cat: 'b', category_margin: 2, extra: 8 }];
  const gold = [{ cat: 'a', margin: 1 }, { cat: 'b', margin: 2 }];
  assert.strictEqual(compareResults(agent, gold), 'subset');
});

test('containsAll refuses to re-map a same-named column that disagrees', () => {
  // `margin` exists on both sides and differs; the search must not quietly
  // rebind gold.margin to the agent's other column just because it agrees.
  const agent = [{ margin: 1, other: 42 }];
  const gold = [{ margin: 42 }];
  assert.strictEqual(containsAll(agent, gold), false);
});

test('compareResults is order-insensitive', () => {
  const a = [{ y: 2023, v: 1 }, { y: 2024, v: 2 }];
  const b = [{ y: 2024, v: 2 }, { y: 2023, v: 1 }];
  assert.strictEqual(compareResults(a, b), 'exact');
});

test('compareResults absorbs float noise but not real differences', () => {
  assert.strictEqual(compareResults([{ v: 0.1 + 0.2 }], [{ v: 0.3 }]), 'exact');
  assert.strictEqual(compareResults([{ v: 0.31 }], [{ v: 0.3 }]), 'none');
});

test('compareResults: an empty gold never passes', () => {
  assert.strictEqual(containsAll([{ v: 1 }], []), false);
});

// ---- query text handling ----------------------------------------------------
test('stripImports removes import lines and keeps the query verbatim', () => {
  const q = 'import "models/sales.malloy"\nrun: sales_order -> { aggregate: total_sales }';
  assert.strictEqual(stripImports(q), 'run: sales_order -> { aggregate: total_sales }');
});

test('referencedSource finds the source, including the parameterised form', () => {
  assert.strictEqual(referencedSource('run: sales_order -> { aggregate: x }'), 'sales_order');
  assert.strictEqual(
    referencedSource('run: order_line_in_context(reporting_currency is "USD") -> { aggregate: x }'),
    'order_line_in_context',
  );
  assert.strictEqual(referencedSource('query: customer -> { aggregate: x }'), 'customer');
  assert.strictEqual(referencedSource('source: foo is bar'), null);
});

test('referencedSource sees past a leading import', () => {
  const q = 'import "models/sales.malloy"\n\nrun: sales_order -> { aggregate: x }';
  assert.strictEqual(referencedSource(q), 'sales_order');
});

test('resolveModelFor prefers the model that DEFINES a source over one that sees it', () => {
  const index = {
    defines: { sales_order: 'models/sales.malloy' },
    exposes: { sales_order: ['models/base.malloy', 'models/sales.malloy'] },
  };
  assert.strictEqual(
    resolveModelFor('run: sales_order -> { aggregate: x }', index),
    'models/sales.malloy',
  );
});

test('resolveModelFor falls back to any model that exposes an imported source', () => {
  const index = { defines: {}, exposes: { customer: ['models/base.malloy'] } };
  assert.strictEqual(resolveModelFor('run: customer -> { aggregate: x }', index), 'models/base.malloy');
  assert.strictEqual(resolveModelFor('run: nowhere -> { aggregate: x }', index), null);
});

// ---- shared model plumbing (SIMP-3) ------------------------------------------
// definedIn is what separates "this file defines it" from "this file imports
// it". Both build.js and the harness depend on it, which is why it is now one
// function rather than two copies.
test('definedIn distinguishes a definition from an import', () => {
  const selfUrl = 'file:///repo/models/sales.malloy';
  assert.strictEqual(definedIn({ url: selfUrl }, selfUrl, 'sales.malloy'), true);
  assert.strictEqual(definedIn({ url: 'file:///repo/models/base.malloy' }, selfUrl, 'sales.malloy'), false);
  assert.strictEqual(definedIn(null, selfUrl, 'sales.malloy'), false);
  assert.strictEqual(definedIn({}, selfUrl, 'sales.malloy'), false);
});

test('listModelFiles is sorted, so compile order is platform-independent', () => {
  const files = listModelFiles('models');
  assert.ok(files.length > 0, 'expected models/*.malloy to exist');
  assert.deepStrictEqual(files, [...files].sort());
  assert.ok(files.every((f) => f.endsWith('.malloy')));
});

// ---- tier 1 (EVAL-12a / SIMP-1) ---------------------------------------------
// The whole reason tier 1 is cheap is that its output is structured. If the
// parse is loose, the tier grades noise; if it is brittle, it fails correct
// answers over punctuation.
test('parseJsonBlock reads a fenced json block', () => {
  const { data, error } = parseJsonBlock('Here you go:\n```json\n{"concepts":["kp:X"],"malloy":null}\n```\n');
  assert.strictEqual(error, null);
  assert.deepStrictEqual(data.concepts, ['kp:X']);
});

test('parseJsonBlock falls back to a bare object', () => {
  const { data, error } = parseJsonBlock('{"concepts":[],"governed":false}');
  assert.strictEqual(error, null);
  assert.strictEqual(data.governed, false);
});

test('parseJsonBlock reports failure rather than returning empty', () => {
  const { data, error } = parseJsonBlock('I cannot answer that.');
  assert.strictEqual(data, null);
  assert.match(error, /no parseable JSON/);
});

test('toRun maps a structured reply onto the shape grade.js consumes', () => {
  const run = toRun({
    concepts: ['kp:AverageOrderValue'],
    malloy: 'run: sales_performance -> { aggregate: average_order_value }',
    answer: 'AOV was $12.50. Basis: kp:AverageOrderValue | Freshness: 2024-04-20 | Steward: sales',
  }, 'raw');
  assert.deepStrictEqual(run.executedMalloy, ['run: sales_performance -> { aggregate: average_order_value }']);
  assert.strictEqual(run.malloy_tool_calls, 1);
  assert.match(run.traceText, /kp:AverageOrderValue/);
  assert.match(run.answer, /Basis:/);
});

test('toRun counts a proposed query as a Malloy call, so AGT-3 keeps its meaning', () => {
  // refusal-routing-decision budgets max_malloy_calls: 0. Proposing a query to
  // answer a pure routing question is still spending one.
  assert.strictEqual(toRun({ concepts: [], malloy: null, answer: 'not governed' }, '').malloy_tool_calls, 0);
  assert.strictEqual(toRun({ concepts: [], malloy: 'run: x -> { aggregate: y }', answer: '' }, '').malloy_tool_calls, 1);
});

test('toRun survives an unparseable reply without inventing content', () => {
  const run = toRun(null, 'the model said something else');
  assert.strictEqual(run.answer, 'the model said something else');
  assert.deepStrictEqual(run.executedMalloy, []);
  assert.strictEqual(run.malloy_tool_calls, 0);
});

test('the tier-1 prompt carries the routing table and states the binding notation', () => {
  const p = buildPrompt({ question: 'What was the AOV in 2023?', routingTable: '| Concept | Binding |' });
  assert.match(p, /NO TOOLS/);
  assert.match(p, /\| Concept \| Binding \|/);
  assert.match(p, /What was the AOV in 2023\?/);
  // the notation note that stops `run: sales.sales_performance`
  assert.match(p, /Do not prefix the source with the model name/);
});

test('the repair prompt restates context and carries the compiler error', () => {
  const p = buildRepairPrompt({
    question: 'q', routingTable: 'TABLE', previous: '{"malloy":"run: x"}',
    error: 'Aggregate expressions are not allowed in `where:`; use `having:`',
  });
  assert.match(p, /TABLE/);                       // stateless: full context restated
  assert.match(p, /Aggregate expressions are not allowed/);
  assert.match(p, /dialect correction, not a re-think/);
});

// ---- prompt-cache reuse (EVAL-12c) -------------------------------------------
// Caching is content-keyed on the PREFIX, so tier 1's ~11k-token preamble +
// routing table is written once per sweep and read by every run after it.
// Measured 2026-07-30: cold $0.12-0.16 a run, warm $0.025-0.033. Nothing about a
// verdict changes if this breaks — which is exactly why it needs a test rather
// than trust. Anything case-specific placed above the routing table takes the
// ~5x back silently.
test('every tier-1 case shares one byte-identical cacheable prefix', () => {
  const table = '| Concept | Binding |\n| kp:TotalSales | sales.sales_order.total_sales |';
  const a = buildPrompt({ question: 'What was the AOV in 2023?', routingTable: table });
  const b = buildPrompt({ question: 'Do we govern customer lifetime value?', routingTable: table });
  const prefixOf = (p) => p.slice(0, p.lastIndexOf('QUESTION: '));

  assert.strictEqual(prefixOf(a), prefixOf(b));
  assert.ok(prefixOf(a).includes(table), 'the routing table must be inside the shared prefix');
  // the question is genuinely last, not merely also-at-the-end
  assert.ok(a.endsWith('What was the AOV in 2023?'));
  assert.ok(!prefixOf(a).includes('AOV'), 'no part of the question may appear above the prefix boundary');
});

test('the repair prompt extends the cacheable prefix instead of rebuilding one', () => {
  const base = buildPrompt({ question: 'q1', routingTable: 'TABLE' });
  const repair = buildRepairPrompt({
    question: 'q1', routingTable: 'TABLE', previous: '{"malloy":"run: x"}', error: 'boom',
  });
  assert.ok(repair.startsWith(base), 'a repair must append below the question, never above it');
});

test('usage accumulates across a repair round, so the breakdown matches the total', () => {
  // aov-synonym run 2 (2026-07-30) recorded tokens 34,774 against a usage
  // breakdown summing to 17,686: two API calls, one envelope kept. The
  // breakdown is the sensor this whole item reads, so it must not under-report.
  const call1 = {
    input_tokens: 2, output_tokens: 900, cache_read_input_tokens: 2711,
    cache_creation_input_tokens: 13258,
  };
  const call2 = {
    input_tokens: 2, output_tokens: 183, cache_read_input_tokens: 5803,
    cache_creation_input_tokens: 10798,
  };
  const acc = addUsage(addUsage(null, call1), call2);
  assert.strictEqual(acc.cache_creation_input_tokens, 24056);
  assert.strictEqual(acc.cache_read_input_tokens, 8514);
  assert.strictEqual(sumTokens(acc), sumTokens(call1) + sumTokens(call2));
});

test('addUsage tolerates a missing envelope without zeroing what it has', () => {
  const acc = addUsage({ input_tokens: 5 }, null);
  assert.deepStrictEqual(acc, { input_tokens: 5 });
  assert.strictEqual(addUsage(null, null), null);
  assert.strictEqual(sumTokens(null), 0);
});

// The two above pin addUsage. This one pins that askTier1 actually USES it —
// the distinction that let the first draft of this test stay green against the
// exact bug it was written for.
const envelope = (usage, malloy, cost = 0.1) => ({
  envelope: {
    result: '```json\n' + JSON.stringify({ concepts: ['kp:X'], malloy, answer: 'a' }) + '\n```',
    usage, total_cost_usd: cost, num_turns: 1, session_id: 's',
  },
  error: null,
});

test('a repaired tier-1 run reports the usage of BOTH calls, not just the last', async () => {
  const calls = [
    envelope({ input_tokens: 2, output_tokens: 900, cache_read_input_tokens: 2711, cache_creation_input_tokens: 13258 }, 'run: broken'),
    envelope({ input_tokens: 2, output_tokens: 183, cache_read_input_tokens: 5803, cache_creation_input_tokens: 10798 }, 'run: fixed'),
  ];
  let n = 0;
  const run = await askTier1({
    question: 'q',
    kpIndex: 'kp/index.md',
    call: async () => calls[n++],
    // fail the first proposed query, accept the second: one repair round
    validate: async (q) => (q === 'run: broken' ? 'compile error' : null),
  });

  assert.strictEqual(run.repairs, 1);
  assert.strictEqual(n, 2, 'the repair round must have made a second call');
  assert.strictEqual(run.usage.cache_creation_input_tokens, 24056);
  assert.strictEqual(run.usage.cache_read_input_tokens, 8514);
  // the breakdown and the total must describe the same run
  assert.strictEqual(sumTokens(run.usage), run.tokens);
  assert.ok(Math.abs(run.cost_usd - 0.2) < 1e-9);
  assert.deepStrictEqual(run.executedMalloy, ['run: fixed']);
});

test('a tier-1 run that needs no repair makes exactly one call', async () => {
  let n = 0;
  const run = await askTier1({
    question: 'q',
    kpIndex: 'kp/index.md',
    call: async () => { n++; return envelope({ input_tokens: 2, output_tokens: 500, cache_read_input_tokens: 15994, cache_creation_input_tokens: 0 }, 'run: fine'); },
    validate: async () => null,
  });
  assert.strictEqual(n, 1);
  assert.strictEqual(run.repairs, 0);
  assert.strictEqual(run.usage.cache_creation_input_tokens, 0);   // a fully warm run
  assert.strictEqual(sumTokens(run.usage), run.tokens);
});

// ---- case tiers --------------------------------------------------------------
test('a case defaults to tier 2, so nothing becomes cheap by accident', () => {
  assert.strictEqual(DEFAULT_TIER, 2);
  const c = loadCase('kp/agent/evals/no-rederivation-margin.md');
  assert.strictEqual(c.tier, 2);
});

test('a declared tier is honoured, and an unknown one is an error', () => {
  assert.strictEqual(loadCase('kp/agent/evals/aov-synonym.md').tier, 1);
  assert.strictEqual(loadCase('kp/agent/evals/membership-verbatim.md').tier, 2);
});

// ---- the correlation check (EVAL-12) -----------------------------------------
// This is the gate on SIMP-1's deletions, so its arithmetic is the last place a
// wrong answer should be able to hide. Every case below is a way the check
// could quietly report "the cheap lane is fine" when it is not.
const row = (o) => ({
  case: 'c', category: 'x', pass: true, tier: 1, tier_declared: 1,
  cross_checks: [], kind_pass: true, cost_usd: 0.1, tokens: 100, ...o,
});
const pair = (t1, t2, declared = 1) => [
  ...t1.map((p) => row({ tier: 1, tier_declared: declared, pass: p })),
  ...t2.map((p) => row({ tier: 2, tier_declared: declared, pass: p })),
];

test('both lanes passing is the only outcome that establishes the proxy', () => {
  const r = correlate(pair([true, true, true], [true, true, true]));
  assert.strictEqual(r.cases[0].class, CLASS.AGREE_PASS);
  assert.strictEqual(r.summary.verdict, 'ESTABLISHED');
  assert.strictEqual(r.summary.established, 1);
});

test('tier 1 passing what tier 2 fails is a FALSE GREEN and fails the gate', () => {
  // The dangerous direction: the suite would be green over a broken product.
  const r = correlate(pair([true, true, true], [true, false, false]));
  assert.strictEqual(r.cases[0].class, CLASS.FALSE_GREEN);
  assert.strictEqual(r.cases[0].gate, 'fail');
  assert.deepStrictEqual(r.summary.false_green, ['c']);
  assert.strictEqual(r.summary.verdict, 'BROKEN');
});

test('tier 1 failing what tier 2 passes is a FALSE RED and still fails the gate', () => {
  // membership-verbatim: loud rather than silent, but the proxy is broken.
  const r = correlate(pair([false, false, false], [true, true, true]));
  assert.strictEqual(r.cases[0].class, CLASS.FALSE_RED);
  assert.strictEqual(r.cases[0].gate, 'fail');
  assert.match(r.cases[0].note, /move it back to tier 2/);
});

test('a lane that is merely flaky does not count as passing', () => {
  // Quorum is unanimity by default: 2 of 3 in tier 2 is not a tier-2 pass, and
  // the pair is therefore a false green, not agreement.
  const r = correlate(pair([true, true, true], [true, true, false]));
  assert.strictEqual(r.cases[0].class, CLASS.FALSE_GREEN);
  assert.strictEqual(r.cases[0].tier2.flaky, true);
});

test('both lanes failing for DIFFERENT reasons is not agreement', () => {
  const rows = [
    row({ tier: 1, pass: false, kind_pass: false }),
    row({ tier: 2, pass: false, kind_pass: true, cross_checks: [{ check: 'must_use', pattern: 'kp:X' }] }),
  ];
  const r = correlate(rows);
  assert.strictEqual(r.cases[0].class, CLASS.AGREE_FAIL_DIFFERENT);
  assert.strictEqual(r.summary.established, 0);
  assert.strictEqual(r.summary.verdict, 'NOT_ESTABLISHED');
});

test('both lanes failing the same way is consistent but still proves nothing', () => {
  const same = { pass: false, kind_pass: true, cross_checks: [{ check: 'must_use' }] };
  const r = correlate([row({ tier: 1, ...same }), row({ tier: 2, ...same })]);
  assert.strictEqual(r.cases[0].class, CLASS.AGREE_FAIL_SAME);
  assert.strictEqual(r.cases[0].gate, 'warn');
  assert.strictEqual(r.cases[0].establishes, false);
  assert.deepStrictEqual(r.summary.inconclusive, ['c']);
});

test('an unknown failure reason never compares equal to a known one', () => {
  // Rows written before kind_pass existed carry no reason. Treating that as a
  // match would manufacture agreement out of missing telemetry.
  const old = { pass: false, kind_pass: undefined, cross_checks: [] };
  const r = correlate([row({ tier: 1, ...old }), row({ tier: 2, ...old })]);
  assert.strictEqual(reasonKey(row({ pass: false, kind_pass: undefined })), '?');
  assert.strictEqual(r.cases[0].class, CLASS.AGREE_FAIL_DIFFERENT);
});

test('a missing lane is INCOMPLETE, never a pass', () => {
  const r = correlate(pair([true, true, true], []));
  assert.strictEqual(r.cases[0].class, CLASS.INCOMPLETE);
  assert.strictEqual(r.cases[0].gate, 'fail');
  assert.strictEqual(r.summary.verdict, 'BROKEN');
});

test('a tier-2 case run cheap is a PROBE: it reports eligibility, it never fails the gate', () => {
  const disagree = correlate(pair([true, true, true], [false, false, false], 2));
  assert.strictEqual(disagree.cases[0].gate, 'ok');
  assert.strictEqual(disagree.cases[0].probe, true);
  assert.strictEqual(disagree.cases[0].eligible, false);
  assert.strictEqual(disagree.summary.correlated, 0);   // probes prove nothing either way
  assert.strictEqual(disagree.summary.verdict, 'NOT_ESTABLISHED');

  const agree = correlate(pair([true, true, true], [true, true, true], 2));
  assert.deepStrictEqual(agree.summary.promotable, ['c']);
});

test('an empty comparison is NOT_ESTABLISHED — nothing correlated is not success', () => {
  assert.strictEqual(correlate([]).summary.verdict, 'NOT_ESTABLISHED');
});

test('run_meta lines are not mistaken for results', () => {
  const r = correlate([{ kind: 'run_meta', cases: 1 }, ...pair([true], [true])]);
  assert.strictEqual(r.cases.length, 1);
  assert.strictEqual(r.cases[0].tier1.total, 1);
});

test('laneVerdict sums what the tiering exists to reduce', () => {
  const v = laneVerdict([row({ cost_usd: 0.1, tokens: 100 }), row({ cost_usd: 0.2, tokens: 250 })]);
  assert.ok(Math.abs(v.cost_usd - 0.3) < 1e-9);
  assert.strictEqual(v.tokens, 350);
});

test('two lanes at different semantic identities are not comparable', () => {
  // Otherwise --from silently compares two different products and calls the
  // difference a lane disagreement.
  const problems = provenanceProblems(
    { semantic_identity: 'sha256:aaa', data_source: 'fixtures@1', model_id: 'm' },
    { semantic_identity: 'sha256:bbb', data_source: 'fixtures@1', model_id: 'm' },
  );
  assert.strictEqual(problems.length, 1);
  assert.match(problems[0], /two different products/);
  assert.deepStrictEqual(
    provenanceProblems({ semantic_identity: 'sha256:aaa' }, { semantic_identity: 'sha256:aaa' }), []);
});

// ---- transport failures are not verdicts -------------------------------------
// Found by the correlation check's first real run: three of six tier-1 calls
// came back "API Error: 529 Overloaded", the grader scored that text as an
// answer that routed to no concepts, and the check reported a lane
// disagreement that was entirely the API's.
test('transportErrorOf recognises an API error and knows what is worth retrying', () => {
  const overloaded = transportErrorOf('API Error: 529 Overloaded. This is a server-side issue…');
  assert.strictEqual(overloaded.status, 529);
  assert.strictEqual(overloaded.retryable, true);
  assert.strictEqual(transportErrorOf('API Error: 429 rate limited').retryable, true);
  // Credentials will not fix themselves — still not an answer, still not retried.
  assert.strictEqual(transportErrorOf('API Error: 401 Unauthorized').retryable, false);
  assert.ok(transportErrorOf('fetch failed'));
});

test('transportErrorOf does not fire on an answer that merely mentions an error', () => {
  // Anchored to the first line: the whole point is that the CLI returns the
  // error INSTEAD of an answer. An answer discussing one is still an answer.
  assert.strictEqual(
    transportErrorOf('Total sales were $1.2M.\n\nNote: an API Error: 500 was retried mid-run.'), null);
  assert.strictEqual(transportErrorOf('AOV was $12.50'), null);
  assert.strictEqual(transportErrorOf(''), null);
});

test('a run that never answered is excluded from the lane, not scored as a failure', () => {
  const rows = [
    row({ tier: 1, pass: true }), row({ tier: 1, pass: true }), row({ tier: 1, pass: true }),
    row({ tier: 2, pass: true }), row({ tier: 2, pass: true }),
    row({ tier: 2, pass: false, errored: true }),
  ];
  const r = correlate(rows, { quorum: 3 });
  // Two completed tier-2 runs is fewer than the quorum, so the lane has no
  // verdict at all — this must NOT read as "tier 2 failed" (a false green).
  assert.strictEqual(r.cases[0].tier2.errored, 1);
  assert.strictEqual(r.cases[0].tier2.present, false);
  assert.strictEqual(r.cases[0].class, CLASS.INCOMPLETE);
  assert.match(r.cases[0].note, /nothing was compared/);
});

test('a lane still has a verdict when every run answered', () => {
  const r = correlate(pair([true, true, true], [true, true, true]), { quorum: 3 });
  assert.strictEqual(r.cases[0].tier1.errored, 0);
  assert.strictEqual(r.cases[0].class, CLASS.AGREE_PASS);
});

test('a provenance problem outranks perfect agreement', () => {
  // Found by running the CLI: the two lanes agreed case by case, the verdict
  // line read ESTABLISHED, and the exit code was 1. A headline that contradicts
  // the exit code is exactly the false signal this harness keeps producing.
  const r = correlate(pair([true, true, true], [true, true, true]),
    { problems: ['semantic identity differs between the lanes'] });
  assert.strictEqual(r.cases[0].class, CLASS.AGREE_PASS);
  assert.strictEqual(r.summary.verdict, 'INVALID');
});

test('classify and verdictFor agree on which direction is dangerous', () => {
  const passing = { present: true, pass: true, reasons: [] };
  const failing = { present: true, pass: false, reasons: ['kind'] };
  assert.strictEqual(classify(passing, failing), CLASS.FALSE_GREEN);
  assert.match(verdictFor(CLASS.FALSE_GREEN, 1).note, /certifies behaviour the real agent does not exhibit/);
  assert.strictEqual(verdictFor(CLASS.AGREE_PASS, 1).establishes, true);
  assert.strictEqual(verdictFor(CLASS.AGREE_PASS, 2).establishes, false);
});

// ---- impact selection (EVAL-12b) ---------------------------------------------
// Every test here is a way the fingerprint could miss a change, and a missed
// change means a case is skipped while the thing it tests is broken. That is a
// FALSE GREEN arrived at without even running the suite, so the bar is: name
// each input a verdict can depend on, and prove that moving it moves the hash.
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

function fixture() {
  const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kp-select-'));
  const kp = nodePath.join(root, 'kp');
  const w = (rel, text) => {
    const p = nodePath.join(kp, rel);
    fs.mkdirSync(nodePath.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
    return p;
  };
  w('agent/examples.md', '# examples\n');
  w('agent/corrections.md', '# corrections\n');
  const casePath = w('agent/evals/aov.md', '---\ntype: eval\n---\nbody\n');
  w('sales/aov.md', '---\nuri: kp:AOV\nlast_validated: 2026-07-01\n---\nAverage revenue per order.\n');
  w('sales/order.md', '---\nuri: kp:Order\n---\nAn order.\n');
  w('sales/margin.md', '---\nuri: kp:Margin\n---\nRevenue minus cost.\n');

  const canon = {
    'kp:AOV': { kind: 'measure', status: 'approved', _path: nodePath.join('sales', 'aov.md'), of: 'kp:Order' },
    'kp:Order': { kind: 'entity', status: 'approved', _path: nodePath.join('sales', 'order.md') },
    'kp:Margin': { kind: 'measure', status: 'approved', _path: nodePath.join('sales', 'margin.md') },
  };
  const ctx = (over = {}) => planeContext({
    kpDir: kp,
    canon: over.canon || canon,
    modelsDigest: over.modelsDigest || 'MODELS',
    protocolDigest: over.protocolDigest || 'PROTOCOL',
    runtimeSettings: over.runtimeSettings || { malloy: '0.0.403' },
  });
  const kase = { name: 'aov', _path: casePath, must_use: ['kp:AOV'], tier: 1 };
  return { root, kp, w, canon, ctx, kase };
}

test('the fingerprint moves when the case file, its concept, or that concept\'s entity moves', () => {
  const f = fixture();
  const before = caseFingerprint(f.kase, f.ctx());

  f.w('sales/aov.md', '---\nuri: kp:AOV\n---\nTotal sales over order count, EXCLUDING refunds.\n');
  const afterConcept = caseFingerprint(f.kase, f.ctx());
  assert.notStrictEqual(afterConcept, before, 'a definition edit must select the case');

  // `of:` is part of what a measure means — edit the entity and the measure can
  // mean something different without its own file changing a byte.
  f.w('sales/order.md', '---\nuri: kp:Order\n---\nAn order, now excluding cancellations.\n');
  assert.notStrictEqual(caseFingerprint(f.kase, f.ctx()), afterConcept);

  fs.writeFileSync(f.kase._path, '---\ntype: eval\n---\ndifferent question\n');
  assert.notStrictEqual(caseFingerprint(f.kase, f.ctx()), afterConcept);
});

test('a stamp is not a change — last_validated must not select the case', () => {
  // Otherwise every sweep invalidates its own evidence and nothing is ever
  // skipped twice: the EVAL-8 false signal, wearing a new hat.
  const f = fixture();
  const before = caseFingerprint(f.kase, f.ctx());
  f.w('sales/aov.md', '---\nuri: kp:AOV\nlast_validated: 2026-07-31\n---\nAverage revenue per order.\n');
  assert.strictEqual(caseFingerprint(f.kase, f.ctx()), before);
});

test('an unrelated concept edit does NOT select the case — the point of the whole thing', () => {
  const f = fixture();
  const before = caseFingerprint(f.kase, f.ctx());
  f.w('sales/margin.md', '---\nuri: kp:Margin\n---\nRevenue minus cost, at line grain.\n');
  assert.strictEqual(caseFingerprint(f.kase, f.ctx()), before);
});

test('a concept appearing, or becoming approved, selects EVERY case', () => {
  // What any question can route to just changed, including questions whose
  // right answer is "that is not governed". This is why the surface digest is
  // uri|kind|status and not the definitions.
  const f = fixture();
  const before = caseFingerprint(f.kase, f.ctx());
  const added = { ...f.canon, 'kp:CLV': { kind: 'measure', status: 'approved', _path: 'sales/clv.md' } };
  assert.notStrictEqual(caseFingerprint(f.kase, f.ctx({ canon: added })), before);

  const promoted = { ...f.canon, 'kp:Margin': { ...f.canon['kp:Margin'], status: 'draft' } };
  assert.notStrictEqual(caseFingerprint(f.kase, f.ctx({ canon: promoted })), before);
  assert.notStrictEqual(surfaceDigest(added), surfaceDigest(f.canon));
});

test('the shared inputs select everything: hints, models, protocol, runtime', () => {
  const f = fixture();
  const before = caseFingerprint(f.kase, f.ctx());
  assert.notStrictEqual(caseFingerprint(f.kase, f.ctx({ modelsDigest: 'OTHER' })), before);
  assert.notStrictEqual(caseFingerprint(f.kase, f.ctx({ protocolDigest: 'OTHER' })), before);
  assert.notStrictEqual(caseFingerprint(f.kase, f.ctx({ runtimeSettings: { malloy: '0.0.404' } })), before);
  // corrections.md carries standing hints the agent acts on (EVAL-8 keeps it
  // inside the semantic identity for the same reason).
  f.w('agent/corrections.md', '# corrections\n- always report margin in USD\n');
  assert.notStrictEqual(caseFingerprint(f.kase, f.ctx()), before);
});

test('conceptDeps walks of/subtype_of and survives a cycle or an unknown URI', () => {
  const canon = {
    'kp:A': { of: 'kp:B' },
    'kp:B': { subtype_of: 'kp:A' },     // cycle
  };
  assert.deepStrictEqual(conceptDeps(['kp:A'], canon), ['kp:A', 'kp:B']);
  assert.deepStrictEqual(conceptDeps(['kp:Missing'], canon), ['kp:Missing']);
});

// ---- what licenses a skip ----------------------------------------------------
const ledgerOf = (entries) => new Map(entries.map(([k, v]) => [k, v]));

test('a clean, complete measurement at the same fingerprint licenses a skip', () => {
  const f = fixture();
  const fp = caseFingerprint(f.kase, f.ctx());
  const key = evidenceKey({ fingerprint: fp, tier: 1, data_source: 'fixtures@abc', model_id: 'default' });
  const [s] = selectCases([f.kase], {
    ctx: f.ctx(), runs: 3, dataSource: 'fixtures@abc', modelId: 'default',
    ledger: ledgerOf([[key, { passed: 3, failed: 0, errored: 0, files: ['a.jsonl'] }]]),
  });
  assert.strictEqual(s.skip, true);
});

test('one failing or errored run at the fingerprint is enough to re-measure', () => {
  // "Plus last run's failures" needs no special case: a failure is never
  // evidence, and neither is a flaky 4-of-5.
  const f = fixture();
  const fp = caseFingerprint(f.kase, f.ctx());
  const key = evidenceKey({ fingerprint: fp, tier: 1, data_source: 'd', model_id: 'default' });
  const run = (e) => selectCases([f.kase], {
    ctx: f.ctx(), runs: 3, dataSource: 'd', modelId: 'default', ledger: ledgerOf([[key, e]]),
  })[0];

  assert.strictEqual(run({ passed: 3, failed: 1, errored: 0, files: ['a'] }).skip, false);
  assert.strictEqual(run({ passed: 3, failed: 0, errored: 1, files: ['a'] }).skip, false);
  assert.strictEqual(run({ passed: 2, failed: 0, errored: 0, files: ['a'] }).skip, false);
  assert.match(run({ passed: 2, failed: 0, errored: 0, files: ['a'] }).reason, /only 2 passing/);
});

test('evidence from another lane, another dataset or another model is not evidence', () => {
  const f = fixture();
  const fp = caseFingerprint(f.kase, f.ctx());
  const clean = { passed: 3, failed: 0, errored: 0, files: ['a'] };
  const select = (ledger, over = {}) => selectCases([f.kase], {
    ctx: f.ctx(), runs: 3, dataSource: 'fixtures@abc', modelId: 'default', ...over, ledger,
  })[0];

  // a tier-2 pass says nothing about the tier-1 lane this case declares
  const otherLane = ledgerOf([[evidenceKey({ fingerprint: fp, tier: 2, data_source: 'fixtures@abc', model_id: 'default' }), clean]]);
  assert.strictEqual(select(otherLane).skip, false);

  const same = ledgerOf([[evidenceKey({ fingerprint: fp, tier: 1, data_source: 'fixtures@abc', model_id: 'default' }), clean]]);
  assert.strictEqual(select(same).skip, true);
  assert.strictEqual(select(same, { dataSource: 'fixtures@moved' }).skip, false);
  assert.strictEqual(select(same, { modelId: 'claude-opus-5' }).skip, false);
});

test('a case with no must_use is never skipped', () => {
  // refusal-ungoverned declares none: nothing can tell whether the definition
  // that just changed is one it routes to. Undeclared dependencies pay full price.
  const f = fixture();
  const bare = { ...f.kase, must_use: [] };
  const fp = caseFingerprint(bare, f.ctx());
  const key = evidenceKey({ fingerprint: fp, tier: 1, data_source: 'd', model_id: 'default' });
  const [s] = selectCases([bare], {
    ctx: f.ctx(), runs: 3, dataSource: 'd', modelId: 'default',
    ledger: ledgerOf([[key, { passed: 99, failed: 0, errored: 0, files: ['a'] }]]),
  });
  assert.strictEqual(s.skip, false);
  assert.match(s.reason, /no must_use/);
});

test('selection off still fingerprints every case, so this sweep becomes evidence', () => {
  const f = fixture();
  const [s] = selectCases([f.kase], { ctx: f.ctx(), runs: 3, ledger: null });
  assert.strictEqual(s.skip, false);
  assert.match(s.fingerprint, /^sha256:[0-9a-f]{64}$/);
});

test('a skipped-case record can never be read back as a measurement of itself', () => {
  // The ledger and the correlation check both key on this. If a `selection`
  // line counted as a result row, one sweep's pass would propagate forever
  // through sweeps that never ran the case.
  assert.strictEqual(isResultRow({ case: 'aov', pass: true }), true);
  assert.strictEqual(isResultRow({ kind: 'selection', case: 'aov', pass: true }), false);
  assert.strictEqual(isResultRow({ kind: 'run_meta', cases: 6 }), false);
  assert.strictEqual(isResultRow({ pass: true }), false);
});

// ---- concurrency (EVAL-12b) ---------------------------------------------------
test('the first job runs alone, so one cache write serves the whole sweep', () => {
  // Fan out cold and every worker writes its own copy of the ~11k-token prefix,
  // which hands back most of EVAL-12c's 5x. Warm serially, then fan out.
  const jobs = [1, 2, 3, 4, 5, 6];
  const events = [];
  let inFlight = 0, peak = 0;
  return runPool(jobs, 3, async (j) => {
    inFlight++; peak = Math.max(peak, inFlight);
    events.push(`start:${j}`);
    await new Promise((r) => setTimeout(r, 5));
    events.push(`end:${j}`);
    inFlight--;
  }).then(() => {
    assert.strictEqual(events.indexOf('end:1'), 1, 'job 1 must finish before anything else starts');
    assert.strictEqual(peak, 3);
    assert.strictEqual(events.filter((e) => e.startsWith('start:')).length, jobs.length);
  });
});

test('runPool at concurrency 1 is exactly the serial loop', async () => {
  const seen = [];
  await runPool([1, 2, 3], 1, async (j) => {
    seen.push(`start:${j}`);
    await new Promise((r) => setTimeout(r, 1));
    seen.push(`end:${j}`);
  });
  assert.deepStrictEqual(seen, ['start:1', 'end:1', 'start:2', 'end:2', 'start:3', 'end:3']);
  await runPool([], 4, async () => { throw new Error('must not be called'); });
});

test('serialize keeps DuckDB calls from overlapping, and a failure does not wedge the queue', async () => {
  let inFlight = 0, peak = 0;
  const q = serialize(async (x) => {
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 3));
    inFlight--;
    if (x === 'boom') throw new Error('compile error');
    return x;
  });
  const results = await Promise.allSettled([q('a'), q('boom'), q('c')]);
  assert.strictEqual(peak, 1);
  assert.deepStrictEqual(results.map((r) => r.status), ['fulfilled', 'rejected', 'fulfilled']);
  assert.strictEqual(await q('d'), 'd');
});
