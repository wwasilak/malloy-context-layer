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
const path = require('path');
const { pathToFileURL } = require('url');
const malloy = require('@malloydata/malloy');
const { DuckDBConnection } = require('@malloydata/db-duckdb');

const MODELS_DIR = process.env.MODELS_DIR || 'models';
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

const urlReader = { readURL: async (url) => fs.readFileSync(url, 'utf8') };

function newRuntime(workdir) {
  const connection = new DuckDBConnection('duckdb', undefined, workdir);
  return new malloy.SingleConnectionRuntime({ connection, urlReader });
}

// ---- source -> model index --------------------------------------------------
// Compile every model once and record which sources each exposes. A source
// defined in base.malloy is visible from every model that imports it, so prefer
// the model that DEFINES it — deterministic, and keeps the query in the
// narrowest context that can serve it.
async function buildSourceIndex(workdir) {
  const runtime = newRuntime(workdir);
  const files = fs.readdirSync(MODELS_DIR).filter((f) => f.endsWith('.malloy')).sort();
  const defines = {};   // source -> model file that defines it
  const exposes = {};   // source -> [model files that can see it]
  const problems = [];

  for (const f of files) {
    const filePath = path.join(MODELS_DIR, f);
    const selfUrl = pathToFileURL(path.resolve(filePath)).href;
    let model;
    try {
      model = await runtime.loadModel(new URL(selfUrl)).getModel();
    } catch (e) {
      problems.push(`${filePath}: ${e.message || e}`);
      continue;
    }
    const selfFile = path.basename(filePath);
    for (const exp of model.explores) {
      (exposes[exp.name] ||= []).push(filePath);
      const loc = exp.location;
      const definedHere = !!loc && !!loc.url && (loc.url === selfUrl || loc.url.endsWith('/' + selfFile));
      if (definedHere && !defines[exp.name]) defines[exp.name] = filePath;
    }
  }
  if (problems.length) throw new Error('model compilation failed:\n  ' + problems.join('\n  '));
  return { defines, exposes };
}

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
async function runQuery(queryText, { workdir, index, rowLimit = 200 }) {
  const text = stripImports(queryText);
  const modelFile = resolveModelFor(text, index);
  if (!modelFile) {
    const src = referencedSource(text);
    throw new Error(src ? `no model exposes source '${src}'` : 'could not find a run: statement to execute');
  }
  const runtime = newRuntime(workdir);
  const mm = runtime.loadModel(new URL(pathToFileURL(path.resolve(modelFile)).href));
  const result = await mm.loadQuery(text).run({ rowLimit });
  return { rows: result.data.toObject(), modelFile };
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
  containsAll, MATCH_RANK,
  scalarFrom, referencedSource, stripImports, resolveModelFor, runtimeVersions,
  MODELS_DIR,
};
