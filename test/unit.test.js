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
const { parseJsonBlock, toRun, buildPrompt, buildRepairPrompt } = require('../evals/lib/tier1');
const { loadCase, DEFAULT_TIER } = require('../evals/lib/cases');

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
