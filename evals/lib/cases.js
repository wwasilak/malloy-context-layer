// =============================================================================
// cases.js — load + validate eval cases from evals/cases/*.md.
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

// EVAL-18: case files live OUTSIDE the kp/ tree the agent under test explores,
// so a run can't read its own answer key (gold_query + reasoning) off disk.
const EVALS_DIR = process.env.EVALS_DIR || path.join('evals', 'cases');

// How a case is graded. `analysis` is not in the original spec list but is in
// use (financial-situation-projection) — it means "no single gold artifact;
// grade on the cross-checks": the concepts that must be reached for and the
// patterns that must not appear.
const EXPECT_KINDS = new Set(['numeric', 'refusal', 'contains', 'query_shape', 'analysis']);

// Weakest result-set match a query_shape case will accept (EVAL-9).
const MATCH_TIERS = new Set(['subset', 'values', 'exact']);
const DEFAULT_MATCH = 'subset';

// How far must_not_contain reaches (see grade.js's committedSegments):
//   'all'   (default) — every executed query. Right when the pattern must
//           never be true regardless of why a query ran.
//   'final' — only the last executed query. Opt in when a legitimate
//           verification query would otherwise trip the check on the way to
//           a correct final answer.
const MNC_SCOPES = new Set(['all', 'final']);
const DEFAULT_MNC_SCOPE = 'all';

// How the case is EXECUTED (EVAL-12a):
//   1 — one call, no tools, structured JSON. The case tests a DECISION:
//       which concepts, what query. Seconds, and no trajectory to parse.
//   2 — full agentic run. Only where multi-turn behaviour IS the test:
//       self-verification, iterating on a compile error, logging discipline.
// Default 2, deliberately: a case is only cheap once someone has decided it
// can be, and silently demoting existing cases would change what they test
// without anyone choosing that.
const RUN_TIERS = new Set([1, 2]);
const DEFAULT_TIER = 2;

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
  if (d.max_malloy_calls != null && !(Number.isInteger(d.max_malloy_calls) && d.max_malloy_calls >= 0))
    errors.push(`max_malloy_calls must be a non-negative integer (found '${d.max_malloy_calls}')`);
  if (d.tier != null && !RUN_TIERS.has(Number(d.tier)))
    errors.push(`unknown tier '${d.tier}' (expected: ${[...RUN_TIERS].join(' | ')})`);
  if (d.must_not_contain_scope != null && !MNC_SCOPES.has(String(d.must_not_contain_scope)))
    errors.push(`unknown must_not_contain_scope '${d.must_not_contain_scope}' (expected: ${[...MNC_SCOPES].join(' | ')})`);

  // EVAL-10: an `analysis` case has no gold artifact — the cross-checks ARE the
  // grade. With none of them set it passes unconditionally, forever, while
  // looking like coverage. A test that cannot fail is worse than no test: it
  // reports confidence it never earned.
  //
  // SIMP-5 tightened this, because "at least one cross-check" turned out to be
  // satisfiable by a cross-check that proves nothing. `must_use` searches the
  // whole trace INCLUDING tool results, and every approved concept is annotated
  // in some model file (SIMP-4 made "approved but unbuilt" a hard failure), so
  // any agent that compiles a model has the required URIs echoed into its trace
  // for free. The first live selftest caught exactly that: an analysis case
  // carrying only `must_use` passed against a deliberately ungoverned protocol,
  // with no receipt and no visit to the Knowledge Plane.
  //
  // So an analysis case needs a check the MODEL FILES cannot satisfy on its
  // behalf: a forbidden pattern it must not commit to, or the AGT-1 receipt.
  const discriminating =
    toList(d.must_not_contain).length || d.expect_receipt === true;
  if (d.expect_kind === 'analysis' && !discriminating)
    errors.push(
      `analysis case needs must_not_contain or expect_receipt` +
      (toList(d.must_use).length
        ? ` — must_use alone is not enough at tier 2: every approved concept is annotated in models/, so a compile echoes those URIs into the trace and the check passes without the agent routing to anything`
        : ` — without one it is graded on nothing and passes unconditionally`));

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
    must_not_contain_scope: d.must_not_contain_scope ? String(d.must_not_contain_scope) : DEFAULT_MNC_SCOPE,
    // opt-in: assert the AGT-1 provenance footer is present. Presence is
    // ALWAYS recorded as telemetry regardless (see grade.js).
    expect_receipt: d.expect_receipt === true,
    // weakest acceptable result-set match for query_shape (EVAL-9)
    min_match: d.min_match ? String(d.min_match) : DEFAULT_MATCH,
    // AGT-3: cap the Malloy tool calls a case may spend. Cost is a behavioural
    // assertion where the right answer is a DECISION — routing a term that is
    // not governed needs no query at all.
    max_malloy_calls: d.max_malloy_calls == null ? null : Number(d.max_malloy_calls),
    // execution lane (EVAL-12a) — see RUN_TIERS
    tier: d.tier == null ? DEFAULT_TIER : Number(d.tier),
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
  RUN_TIERS, DEFAULT_TIER, MNC_SCOPES, DEFAULT_MNC_SCOPE,
};
