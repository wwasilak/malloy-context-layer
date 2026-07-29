// =============================================================================
// cases.js — load + validate eval cases from kp/agent/evals/*.md.
//
//   A case is an operational doc (type: eval), so okf-lib's registry already
//   skips it. Here we parse the SAME files for the runner. Frontmatter is the
//   contract; the prose body is intent for humans and is not graded.
//
//   Field normalisation matters more than it looks: cases were hand-authored
//   before the runner existed, so `must_use` appears both as a YAML list and as
//   a comma-separated string. Normalise on read rather than rewriting the cases
//   — the authoring surface stays forgiving, the runner sees one shape.
// =============================================================================
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const EVALS_DIR = process.env.EVALS_DIR || path.join('kp', 'agent', 'evals');

// How a case is graded. `analysis` is not in the original spec list but is in
// use (financial-situation-projection) — it means "no single gold artifact;
// grade on the cross-checks": the concepts that must be reached for and the
// patterns that must not appear.
const EXPECT_KINDS = new Set(['numeric', 'refusal', 'contains', 'query_shape', 'analysis']);

// Weakest result-set match a query_shape case will accept (EVAL-9).
const MATCH_TIERS = new Set(['subset', 'values', 'exact']);
const DEFAULT_MATCH = 'subset';

const DEFAULT_TOLERANCE = 0.005;

// accept "kp:A, kp:B", ["kp:A"], or absent -> always an array
const toList = (v) => {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
};

// A gold_query may hold several `run:` statements (a case can need more than
// one query to establish its ground truth). Split so each can be executed and
// compared independently.
function splitRuns(sql) {
  if (!sql) return [];
  return String(sql)
    .split(/^(?=run:)/m)
    .map((s) => s.trim())
    .filter(Boolean);
}

function loadCase(file) {
  const errors = [];
  const rel = file.split(path.sep).join('/');
  let fm;
  try {
    fm = matter(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { name: path.basename(file, '.md'), _path: rel, errors: [`broken YAML frontmatter — ${e.message}`] };
  }
  const d = fm.data || {};
  const name = path.basename(file, '.md');

  if (d.type !== 'eval') errors.push(`type must be 'eval' (found '${d.type || 'none'}')`);
  if (!d.question) errors.push(`missing required field 'question'`);
  if (!d.expect_kind) errors.push(`missing required field 'expect_kind'`);
  else if (!EXPECT_KINDS.has(d.expect_kind))
    errors.push(`unknown expect_kind '${d.expect_kind}' (expected: ${[...EXPECT_KINDS].join(' | ')})`);

  const goldRuns = splitRuns(d.gold_query);

  // per-kind requirements — catch an unrunnable case at load, not mid-run
  if (d.expect_kind === 'numeric' && !goldRuns.length && d.expect_value == null)
    errors.push(`numeric case needs a gold_query (to compute expect_value) or an explicit expect_value`);
  if (d.expect_kind === 'query_shape' && !goldRuns.length)
    errors.push(`query_shape case needs a gold_query to compare against`);
  if (d.expect_kind === 'contains' && !toList(d.expect_contains).length)
    errors.push(`contains case needs a non-empty expect_contains`);
  if (d.min_match != null && !MATCH_TIERS.has(String(d.min_match)))
    errors.push(`unknown min_match '${d.min_match}' (expected: ${[...MATCH_TIERS].join(' | ')})`);

  // EVAL-10: an `analysis` case has no gold artifact — the cross-checks ARE the
  // grade. With none of them set it passes unconditionally, forever, while
  // looking like coverage. A test that cannot fail is worse than no test: it
  // reports confidence it never earned.
  const hasCrossCheck =
    toList(d.must_use).length || toList(d.must_not_contain).length || d.expect_receipt === true;
  if (d.expect_kind === 'analysis' && !hasCrossCheck)
    errors.push(
      `analysis case needs at least one cross-check (must_use, must_not_contain or expect_receipt) — ` +
      `without one it is graded on nothing and passes unconditionally`);

  return {
    name,
    _path: rel,
    title: d.title || name,
    category: d.category || 'uncategorised',
    question: d.question,
    expect_kind: d.expect_kind,
    // null is a legitimate "not computed yet" marker — keep it distinct from 0
    expect_value: d.expect_value == null ? null : Number(d.expect_value),
    tolerance: d.tolerance == null ? DEFAULT_TOLERANCE : Number(d.tolerance),
    expect_contains: toList(d.expect_contains),
    must_use: toList(d.must_use),
    must_not_contain: toList(d.must_not_contain),
    // opt-in: assert the AGT-1 provenance footer is present. Presence is
    // ALWAYS recorded as telemetry regardless (see grade.js).
    expect_receipt: d.expect_receipt === true,
    // weakest acceptable result-set match for query_shape (EVAL-9)
    min_match: d.min_match ? String(d.min_match) : DEFAULT_MATCH,
    gold_query: d.gold_query || null,
    gold_runs: goldRuns,
    errors,
  };
}

function loadCases(dir = EVALS_DIR, filter = null) {
  if (!fs.existsSync(dir)) throw new Error(`evals dir not found: ${dir}`);
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'index.md' && f.toLowerCase() !== 'readme.md')
    .sort()
    .map((f) => path.join(dir, f));

  let cases = files.map(loadCase);
  if (filter) {
    const want = new Set(toList(filter));
    cases = cases.filter((c) => want.has(c.name));
    for (const w of want)
      if (!cases.find((c) => c.name === w)) throw new Error(`no such eval case: ${w}`);
  }
  return cases;
}

module.exports = {
  loadCases, loadCase, splitRuns, toList,
  EVALS_DIR, EXPECT_KINDS, DEFAULT_TOLERANCE, MATCH_TIERS, DEFAULT_MATCH,
};
