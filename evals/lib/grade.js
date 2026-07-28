// =============================================================================
// grade.js — score one agent run against one case.
//
//   Two layers, and the second is the one that catches the failures we actually
//   saw in real sessions:
//
//     1. expect_kind — did it produce the right ARTIFACT (number, refusal,
//        equivalent query, prose)?
//     2. cross-checks — did it get there the right WAY? must_use (the governed
//        concept was reached for) and must_not_contain (the governed concept
//        was not quietly re-derived from raw columns). These run for every kind,
//        because an answer can carry the right number and still be wrong: a
//        re-derived margin agrees with the governed one today and diverges the
//        day the definition changes.
// =============================================================================
const { compareResults } = require('./malloy');

// ---- text helpers -----------------------------------------------------------
// Whitespace-insensitive containment. `sum(line_revenue - line_cost)` and
// `sum(line_revenue-line_cost)` are the same mistake and must both be caught.
const squash = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
const containsLoose = (hay, needle) => squash(hay).includes(squash(needle));

// The AGT-1 provenance footer.
const RECEIPT_RE = /basis\s*:.*\|\s*freshness\s*:/is;
const hasReceipt = (answer) => RECEIPT_RE.test(String(answer || ''));

// Drop the receipt before hunting for the headline figure — it ends in a date
// and a steward name, and "2024-12-31" is not the answer to anything.
function withoutReceipt(answer) {
  return String(answer || '')
    .split('\n')
    .filter((l) => !/^\s*[`*_>\s]*basis\s*:/i.test(l))
    .join('\n');
}

// ---- numeric extraction -----------------------------------------------------
// The fragile part, per the spec. Ordered from most explicit to most heuristic,
// and the method used is always recorded so a bad extraction is debuggable
// rather than mysterious.
function extractNumber(answer) {
  const text = withoutReceipt(answer);
  const num = (s) => {
    const v = Number(String(s).replace(/,/g, ''));
    return Number.isFinite(v) ? v : null;
  };

  // 1. explicit ```result fence — the contract we would like cases to use
  const fence = /```result\s*\n([\s\S]*?)```/i.exec(text);
  if (fence) {
    const m = /-?[\d,]+(?:\.\d+)?/.exec(fence[1]);
    if (m) return { value: num(m[0]), how: 'result-fence' };
  }

  // 2. bold headline — "**$1,234.56**" is how these answers usually present
  const bold = /\*\*\s*[$€£]?\s*(-?[\d,]+(?:\.\d+)?)\s*\*\*/.exec(text);
  if (bold) return { value: num(bold[1]), how: 'bold' };

  // 3. first currency-tagged figure
  const cur = /[$€£]\s?(-?[\d,]+(?:\.\d+)?)/.exec(text);
  if (cur) return { value: num(cur[1]), how: 'currency' };

  // 4. first plain number that is not obviously a year
  const re = /-?\b[\d,]+(?:\.\d+)?\b/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const v = num(raw);
    if (v == null) continue;
    const isYear = /^\d{4}$/.test(raw) && v >= 1900 && v <= 2100;
    if (isYear) continue;
    return { value: v, how: 'first-number' };
  }
  return { value: null, how: 'none' };
}

const withinTolerance = (got, want, tol) => {
  if (got == null || want == null) return false;
  if (want === 0) return Math.abs(got) <= tol;
  return Math.abs(got - want) / Math.abs(want) <= tol;
};

// ---- refusal ----------------------------------------------------------------
// Correct behaviour for an ungoverned term is to SAY it is ungoverned. An
// exploratory number is allowed by CLAUDE.md as long as it is labelled, so the
// test is for the label, not for the absence of arithmetic.
const REFUSAL_MARKERS = [
  'not governed', 'not a governed', 'ungoverned', 'not in the knowledge plane',
  'no governed concept', 'not modelled', 'not modeled', 'exploratory',
  'not defined in the knowledge plane',
];

function gradeRefusal(answer) {
  const hit = REFUSAL_MARKERS.find((mk) => containsLoose(answer, mk));
  return hit
    ? { pass: true, detail: `declined / labelled ungoverned ("${hit}")` }
    : { pass: false, detail: 'no ungoverned/refusal marker in answer — figure may be presented as official' };
}

// ---- query shape (EVAL-2) ---------------------------------------------------
// Grade the METHOD by running the agent's query and the blessed query against
// the same data and diffing result sets. Beats string comparison: it proves
// equivalence without caring about formatting, aliasing or clause order.
async function gradeQueryShape(caseDef, run, ctx) {
  const agentQueries = run.executedMalloy || [];
  if (!agentQueries.length)
    return { pass: false, detail: 'agent executed no Malloy — nothing to compare against gold_query' };

  const agentResults = [];
  for (const q of agentQueries) {
    if (/^\(file\)/.test(q)) continue; // run_file: no inline text to re-execute
    try {
      const r = await ctx.runQuery(q);
      agentResults.push({ q, rows: r.rows });
    } catch (e) {
      agentResults.push({ q, error: e.message || String(e) });
    }
  }
  if (!agentResults.some((r) => r.rows))
    return { pass: false, detail: 'none of the agent queries could be re-executed: ' +
      agentResults.map((r) => r.error).filter(Boolean).join('; ').slice(0, 300) };

  const details = [];
  let allMatched = true;
  for (let i = 0; i < caseDef.gold_runs.length; i++) {
    const gold = caseDef.gold_runs[i];
    let goldRows;
    try {
      goldRows = (await ctx.runQuery(gold)).rows;
    } catch (e) {
      details.push(`gold[${i}] failed to run: ${e.message || e}`);
      allMatched = false;
      continue;
    }
    // Keep the strongest match across the agent's queries. Ranked rather than
    // special-cased, so adding a tier to compareResults cannot silently fall
    // through to 'none' here.
    const RANK = { none: 0, subset: 1, values: 2, exact: 3 };
    let best = 'none';
    for (const ar of agentResults) {
      if (!ar.rows) continue;
      const cmp = compareResults(ar.rows, goldRows);
      if (RANK[cmp] > RANK[best]) best = cmp;
      if (best === 'exact') break;
    }
    details.push(`gold[${i}]: ${best}`);
    if (best === 'none') allMatched = false;
  }

  return {
    pass: allMatched,
    detail: (allMatched ? 'result sets equivalent — ' : 'result set mismatch — ') + details.join(', '),
  };
}

// ---- cross-checks (every kind) ---------------------------------------------
function crossChecks(caseDef, run) {
  const failures = [];
  // must_use searches everything the run touched — reaching for a concept
  // counts whether it shows up in prose, in a query, or in what a tool returned.
  const trace = run.traceText || '';
  // must_not_contain searches only what the agent AUTHORED. Reading a binding's
  // definition is not re-deriving it: `average_order_value` is defined in the
  // model as `total_sales / order_count`, so compile output echoes that
  // expression back to an agent that did exactly the right thing.
  const authored = run.authoredText || run.traceText || '';

  for (const uri of caseDef.must_use) {
    if (!containsLoose(trace, uri)) failures.push(`must_use not referenced anywhere in trace: ${uri}`);
  }
  for (const pat of caseDef.must_not_contain) {
    if (containsLoose(authored, pat)) failures.push(`must_not_contain matched in agent-authored text: ${pat}`);
  }
  if (caseDef.expect_receipt && !hasReceipt(run.answer))
    failures.push('missing AGT-1 provenance receipt (Basis: … | Freshness: …)');

  return failures;
}

// ---- entry point ------------------------------------------------------------
// ctx: { runQuery(text) -> {rows} }
async function grade(caseDef, run, ctx) {
  if (run.error && !run.answer)
    return { pass: false, detail: `agent run failed: ${run.error}`, extracted: null, receipt_present: false };

  let kindResult;
  let extracted = null;

  switch (caseDef.expect_kind) {
    case 'numeric': {
      const ex = extractNumber(run.answer);
      extracted = ex.value;
      if (caseDef.expect_value == null) {
        kindResult = { pass: false, detail: 'expect_value not computed — run `npm run eval:gold` to fill it from gold_query' };
      } else if (ex.value == null) {
        kindResult = { pass: false, detail: 'no number could be extracted from the answer' };
      } else {
        const ok = withinTolerance(ex.value, caseDef.expect_value, caseDef.tolerance);
        kindResult = {
          pass: ok,
          detail: `${ok ? 'within' : 'outside'} tolerance ${caseDef.tolerance}: got ${ex.value} (via ${ex.how}), want ${caseDef.expect_value}`,
        };
      }
      break;
    }
    case 'refusal':
      kindResult = gradeRefusal(run.answer);
      break;
    case 'contains': {
      const missing = caseDef.expect_contains.filter((s) => !containsLoose(run.answer, s));
      kindResult = missing.length
        ? { pass: false, detail: `missing expected substrings: ${missing.join(', ')}` }
        : { pass: true, detail: 'all expect_contains present' };
      break;
    }
    case 'query_shape':
      kindResult = await gradeQueryShape(caseDef, run, ctx);
      break;
    case 'analysis':
      // No single gold artifact: the cross-checks below ARE the grade.
      kindResult = { pass: true, detail: 'analysis case — graded on cross-checks' };
      break;
    default:
      kindResult = { pass: false, detail: `unknown expect_kind '${caseDef.expect_kind}'` };
  }

  const xs = crossChecks(caseDef, run);
  const pass = kindResult.pass && xs.length === 0;
  const detail = [kindResult.detail, ...xs].filter(Boolean).join(' | ');

  return { pass, detail, extracted, receipt_present: hasReceipt(run.answer) };
}

module.exports = { grade, extractNumber, hasReceipt, crossChecks, containsLoose, withinTolerance, REFUSAL_MARKERS };
