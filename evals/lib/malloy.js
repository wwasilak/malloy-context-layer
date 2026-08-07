// =============================================================================
// malloy.js — execute Malloy for the eval loop, the same way build.js does.
//
//   Two jobs:
//     1. run a query (gold, or the one the agent actually executed) against the
//        data, resolving which model file provides the referenced source;
//     2. canonicalise result sets so two queries can be compared for MEANING
//        rather than for text (EVAL-2's "run both and diff" grading).
//
//   Data modes (EVAL-4). The parquet files under ParquetFiles/ are committed to
//   git, so they already ARE the hermetic fixture set: CI checks them out and
//   gets byte-identical data, which is exactly what stable gold values need. We
//   therefore do NOT ship a second sampled copy — `fixtures` means the
//   committed ParquetFiles resolved relative to the repo root (the same WORKDIR
//   mechanism build.js uses), and `live` means an alternate WORKDIR/connection
//   supplied by the environment for scheduled drift runs.
// =============================================================================
const fs = require('fs');
const mal = require('../../malloy-lib');

const MODELS_DIR = mal.MODELS_DIR;
const REPO_ROOT = process.cwd();

// `fixtures` = committed ParquetFiles at the repo root. `live` = whatever
// EVAL_LIVE_WORKDIR points at (a mount or synced copy of the real warehouse
// extract); it stays out of CI by construction.
function workdirFor(mode) {
  if (mode === 'live') {
    const wd = process.env.EVAL_LIVE_WORKDIR;
    if (!wd) throw new Error('--live requires EVAL_LIVE_WORKDIR to point at the live data root');
    if (!fs.existsSync(wd)) throw new Error(`EVAL_LIVE_WORKDIR does not exist: ${wd}`);
    return wd;
  }
  return REPO_ROOT;
}

// Compiling models and indexing which file defines which source is shared with
// build.js — see malloy-lib (SIMP-3). Re-exported here so the harness keeps one
// import.
const buildSourceIndex = (workdir) => mal.buildSourceIndex(workdir, { modelsDir: MODELS_DIR });

// ---- query text handling ----------------------------------------------------
// The agent's executed Malloy arrives with its own `import` lines; we run it in
// the context of an already-loaded model, so those imports are redundant (and
// would resolve against the wrong base). Strip them and keep the rest verbatim.
const stripImports = (q) => String(q).replace(/^\s*import\s+"[^"]*"\s*;?\s*$/gm, '').trim();

// First source referenced by a `run:` / `query:` statement. Handles the
// parameterised form `sales_order(reporting_currency is "USD")`.
function referencedSource(queryText) {
  const m = /(?:^|\n)\s*(?:run|query)\s*:\s*([A-Za-z_]\w*)/.exec(stripImports(queryText));
  return m ? m[1] : null;
}

function resolveModelFor(queryText, index) {
  const src = referencedSource(queryText);
  if (!src) return null;
  if (index.defines[src]) return index.defines[src];
  const seen = index.exposes[src];
  return seen && seen.length ? seen[0] : null;
}

// ---- run --------------------------------------------------------------------
// Resolving WHICH model to run in is the harness's decision (the agent's query
// arrives as bare text); executing it there is malloy-lib's job.
async function runQuery(queryText, { workdir, index, rowLimit = 200 }) {
  const text = stripImports(queryText);
  const modelFile = resolveModelFor(text, index);
  if (!modelFile) {
    const src = referencedSource(text);
    throw new Error(src ? `no model exposes source '${src}'` : 'could not find a run: statement to execute');
  }
  return mal.runQueryIn(modelFile, text, { workdir, rowLimit });
}

// Run several statements (a gold_query may carry more than one) and return all
// result sets in order.
async function runAll(queryTexts, opts) {
  const out = [];
  for (const q of queryTexts) out.push(await runQuery(q, opts));
  return out;
}

// ---- canonicalisation + comparison (EVAL-2) ---------------------------------
// Absorb float noise without hiding real differences.
const round = (n) => {
  if (!Number.isFinite(n)) return n;
  return Number(n.toPrecision(10));
};

function canonValue(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return round(v);
  if (typeof v === 'bigint') return Number(v);
  if (Array.isArray(v)) return v.map(canonValue);
  if (typeof v === 'object') return canonRow(v);
  return String(v);
}

function canonRow(row) {
  const out = {};
  for (const k of Object.keys(row).sort()) out[k] = canonValue(row[k]);
  return out;
}

// Order-insensitive: two queries that produce the same rows in a different
// order carry the same meaning for our purposes, and tie-breaking order is not
// something we want a case to fail on.
const canonRows = (rows) => rows.map(canonRow).map((r) => JSON.stringify(r)).sort();

// Key-insensitive fallback: the agent is free to name its output columns
// differently from the gold query (`margin` vs `total_margin`). Comparing the
// multiset of VALUES catches "same numbers, different labels", which is a pass
// for method grading — recorded distinctly so it is visible in the results.
const canonValuesOnly = (rows) =>
  rows
    .map((r) => JSON.stringify(Object.keys(r).sort().map((k) => canonValue(r[k]))))
    .sort();

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// ---- containment (EVAL-9) ---------------------------------------------------
// `subset` means the agent returned the gold TABLE plus extra COLUMNS — the
// denominator it chose to show next to the count. That is the tier's stated
// rationale and it is a legitimate pass.
//
// It does NOT mean "the gold numbers appear somewhere in the output". The first
// implementation compared flattened value multisets, so a gold scalar of 47
// passed against any 200-row result that happened to contain a 47 anywhere, in
// any column. Extra ROWS are therefore not containment: a different row count is
// a different grain or a missing filter, which is a different answer.

const unionCols = (rows) => [...new Set(rows.flatMap((r) => Object.keys(r)))].sort();

// Bounds on the assignment search below. Real cases map one or two measures;
// these exist so a wide result set cannot turn a comparison into a factorial.
const MAX_UNMAPPED = 3;
const MAX_SPARE = 8;

// Is the gold result a column-projection of the agent's, row for row?
//
// Columns are paired by name where the names agree. What is left over is
// SEARCHED, not guessed: if some injective assignment of the agent's remaining
// columns reproduces the gold table exactly, the gold table is present. The
// agent is free to alias its output (`category_margin is margin`) — the `values`
// tier already tolerates that for whole rows — so refusing to match a rename
// would fail correct answers, and a suite that fails correct behaviour gets
// ignored. What the search cannot do is invent a match: every gold row must
// still appear, with every gold value, under one consistent assignment.
function containsAll(agentRows, goldRows) {
  if (!goldRows.length || agentRows.length !== goldRows.length) return false;

  const goldCols = unionCols(goldRows);
  const agentCols = unionCols(agentRows);
  if (agentCols.length < goldCols.length) return false;

  const byName = {};
  const used = new Set();
  const lower = new Map(agentCols.map((c) => [c.toLowerCase(), c]));
  for (const g of goldCols) {
    const hit = lower.get(g.toLowerCase());
    if (hit) { byName[g] = hit; used.add(hit); }
  }

  const unmapped = goldCols.filter((g) => !(g in byName));
  const spare = agentCols.filter((c) => !used.has(c));
  if (unmapped.length > spare.length) return false;
  if (unmapped.length > MAX_UNMAPPED || spare.length > MAX_SPARE) return false;

  // A rename match must be ANCHORED by something other than the value itself.
  // With a single-row gold and no column name in common, the search has one
  // number and no structure to check it against, so it will bind that number to
  // whichever agent column happens to hold it — `order_count: 47` satisfying a
  // gold `active_customers: 47`. That is EVAL-9's "found anywhere" hole again,
  // surviving in the column dimension after it was closed in the row dimension.
  // Anchor = at least one column agreeing by name, or more than one row (so a
  // coincidence has to repeat). This costs nothing legitimate: a pure rename
  // with no extra columns is already caught one tier up by `values`, and
  // `subset` only decides cases where the agent returned EXTRA columns.
  if (unmapped.length && !Object.keys(byName).length && goldRows.length < 2) return false;

  const project = (rows, pick) =>
    rows.map((r) => JSON.stringify(goldCols.map((g) => canonValue(r[pick(g)])))).sort();
  const goldProjected = project(goldRows, (g) => g);
  const matches = (map) => sameList(goldProjected, project(agentRows, (g) => map[g]));

  // depth-first over injective assignments of `unmapped` -> `spare`
  const search = (i, map, taken) => {
    if (i === unmapped.length) return matches(map);
    for (const c of spare) {
      if (taken.has(c)) continue;
      taken.add(c);
      map[unmapped[i]] = c;
      if (search(i + 1, map, taken)) return true;
      taken.delete(c);
      delete map[unmapped[i]];
    }
    return false;
  };

  return search(0, { ...byName }, new Set());
}

// -> 'exact'  keys and values both match
//    'values' same numbers, different column names (the agent may alias freely)
//    'subset' every gold row is present with its own columns, alongside extra
//             columns the agent chose to return (e.g. a denominator next to the
//             count). Passing, but reported distinctly so a reviewer can
//             disagree — and a case can refuse the tier via `min_match`.
//    'none'
function compareResults(aRows, bRows) {
  if (sameList(canonRows(aRows), canonRows(bRows))) return 'exact';
  if (sameList(canonValuesOnly(aRows), canonValuesOnly(bRows))) return 'values';
  if (containsAll(aRows, bRows)) return 'subset';
  return 'none';
}

// ---- nested results (EVAL-19) -----------------------------------------------
// A Malloy `nest:` makes the agent's answer a summary row (or a few) each
// carrying an ARRAY of sub-rows — e.g. `[{ total, top_customers: [ …5 rows… ] }]`.
// That nested array is a result set the agent genuinely computed; query_shape
// must be able to compare gold against it, or a correct answer presented as
// summary+nest scores 'none'. This is EVAL-9's soundness gap one dimension over:
// EVAL-9 was extra COLUMNS in a flat row, this is a nested ROW SET.
//
// Returns the agent's top-level rows PLUS, for each column that holds arrays of
// objects, the flattened concatenation of those arrays across every row. One
// level deep on purpose: it covers the common summary+nest shape without
// unbounded descent, and the false-positive guards live in `containsAll`
// (an anchored match is still required) — a nest that does not equal gold still
// scores 'none'. A deeper nest is a reason to widen this, not to special-case it.
function candidateRowSets(rows) {
  const sets = [rows];
  if (!rows || !rows.length) return sets;
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  for (const c of cols) {
    const present = rows.map((r) => r[c]).filter((v) => v != null);
    if (!present.length || !present.every((v) => Array.isArray(v))) continue; // not a nest column
    const flat = present.flat().filter((v) => v && typeof v === 'object' && !Array.isArray(v));
    if (flat.length) sets.push(flat);
  }
  return sets;
}

// Strongest match tier of gold against the agent's result, considering both the
// flat rows and any nested row set (EVAL-19). Ranked, never special-cased, so a
// new tier in compareResults cannot silently fall through here.
function bestMatch(agentRows, goldRows) {
  let best = 'none';
  for (const cand of candidateRowSets(agentRows)) {
    const cmp = compareResults(cand, goldRows);
    if (MATCH_RANK[cmp] > MATCH_RANK[best]) best = cmp;
    if (best === 'exact') break;
  }
  return best;
}

// How strong a match a case is willing to accept, weakest-first.
const MATCH_RANK = { none: 0, subset: 1, values: 2, exact: 3 };

// Single headline number out of a result set — used to turn a gold_query into
// an expect_value. Only meaningful when the query returns one row with one
// numeric column, which is what numeric cases are supposed to do.
function scalarFrom(rows) {
  if (!rows || rows.length !== 1) return null;
  const nums = Object.values(rows[0]).filter((v) => typeof v === 'number' || typeof v === 'bigint');
  if (nums.length !== 1) return null;
  return Number(nums[0]);
}

// ---- versions (feeds the semantic identity hash, EVAL-6) --------------------
function runtimeVersions() {
  const ver = (pkg) => {
    try { return require(`${pkg}/package.json`).version; } catch { return 'unknown'; }
  };
  return {
    malloy: ver('@malloydata/malloy'),
    duckdb: ver('@malloydata/db-duckdb'),
    dialect: 'duckdb',
  };
}

module.exports = {
  workdirFor, buildSourceIndex, runQuery, runAll, compareResults, canonRows,
  containsAll, candidateRowSets, bestMatch, MATCH_RANK,
  scalarFrom, referencedSource, stripImports, resolveModelFor, runtimeVersions,
  MODELS_DIR,
};
