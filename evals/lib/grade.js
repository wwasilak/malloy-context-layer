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
//
//   The two cross-checks search DIFFERENT text, and the asymmetry is the whole
//   point (EVAL-7): must_use searches everything the run touched, because
//   reaching for a concept counts however it shows up; must_not_contain searches
//   only what the agent COMMITTED to — its final answer and the queries it
//   actually executed. Exploration is not commitment. A compile of an expression
//   the agent then correctly discards is the loop working, not a violation.
// =============================================================================
const { compareResults, MATCH_RANK } = require('./malloy');

// ---- text helpers -----------------------------------------------------------
// Whitespace-insensitive containment. `sum(line_revenue - line_cost)` and
// `sum(line_revenue-line_cost)` are the same mistake and must both be caught.
const squash = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
const containsLoose = (hay, needle) => squash(hay).includes(squash(needle));

// Squash while remembering where each surviving character came from, so a loose
// match can be reported back with its ORIGINAL surrounding text.
function squashWithMap(s) {
  const str = String(s || '');
  let squashed = '';
  const map = [];
  for (let i = 0; i < str.length; i++) {
    if (/\s/.test(str[i])) continue;
    squashed += str[i].toLowerCase();
    map.push(i);
  }
  return { str, squashed, map };
}

// Locate a loose match and return the matched span plus surrounding context.
// Without this the telemetry cannot adjudicate its own verdict: a
// must_not_contain failure said only WHICH pattern matched, never where or in
// what — which is exactly what made the first sweep's one failure take a manual
// re-read to disprove.
function findLoose(hay, needle, pad = 100) {
  const { str, squashed, map } = squashWithMap(hay);
  const n = squash(needle);
  if (!n) return null;
  const idx = squashed.indexOf(n);
  if (idx === -1) return null;

  const start = map[idx];
  const end = map[idx + n.length - 1] + 1;
  const from = Math.max(0, start - pad);
  const to = Math.min(str.length, end + pad);
  const ellipsis = (cond, s) => (cond ? '…' + s : s);

  return {
    match: str.slice(start, end),
    context: ellipsis(from > 0, str.slice(from, to).replace(/\s+/g, ' ').trim()) + (to < str.length ? '…' : ''),
  };
}

// What the agent COMMITTED to, labelled so a match points at an artifact rather
// than at an undifferentiated blob of trace.
function committedSegments(run) {
  return [
    { where: 'final_answer', text: run.answer || '' },
    ...(run.executedMalloy || []).map((q, i) => ({ where: `executed_malloy[${i}]`, text: q })),
  ];
}

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

  // The weakest tier this case accepts. `subset` (the default) allows the agent
  // to return extra columns alongside the blessed ones; a case that wants the
  // column names pinned too can demand `values` or `exact`.
  const floor = MATCH_RANK[caseDef.min_match] ?? MATCH_RANK.subset;

  const details = [];
  // The match tier per gold query, kept structurally as well as in the prose
  // detail. Two lanes can both PASS a query_shape case at different strengths
  // (exact vs subset), and the correlation check has to be able to see that
  // without regex-scraping its own sentence.
  const matches = [];
  let allMatched = true;
  for (let i = 0; i < caseDef.gold_runs.length; i++) {
    const gold = caseDef.gold_runs[i];
    let goldRows;
    try {
      goldRows = (await ctx.runQuery(gold)).rows;
    } catch (e) {
      details.push(`gold[${i}] failed to run: ${e.message || e}`);
      matches.push({ gold: i, match: 'error', ok: false });
      allMatched = false;
      continue;
    }
    // Keep the strongest match across the agent's queries. Ranked rather than
    // special-cased, so adding a tier to compareResults cannot silently fall
    // through to 'none' here.
    let best = 'none';
    for (const ar of agentResults) {
      if (!ar.rows) continue;
      const cmp = compareResults(ar.rows, goldRows);
      if (MATCH_RANK[cmp] > MATCH_RANK[best]) best = cmp;
      if (best === 'exact') break;
    }
    const ok = MATCH_RANK[best] >= floor;
    matches.push({ gold: i, match: best, ok });
    details.push(`gold[${i}]: ${best}${ok ? '' : ` (below min_match ${caseDef.min_match})`}`);
    if (!ok) allMatched = false;
  }

  return {
    pass: allMatched,
    matches,
    detail: (allMatched ? 'result sets equivalent — ' : 'result set mismatch — ') + details.join(', '),
  };
}

// ---- cross-checks (every kind) ---------------------------------------------
function crossChecks(caseDef, run) {
  const failures = [];
  // must_use searches everything the run touched — reaching for a concept
  // counts whether it shows up in prose, in a query, or in what a tool returned.
  const trace = run.traceText || '';
  // must_not_contain searches only the COMMITTED artifacts: the final answer and
  // the queries that actually ran. Not intermediate prose and not compiles —
  // testing an expression and discarding it is the agent working correctly, and
  // grading it as a violation fails a run for thinking. Reading a binding's
  // definition is likewise not re-deriving it: `average_order_value` is defined
  // in the model as `total_sales / order_count`, so compile output echoes the
  // forbidden expression back at an agent that did exactly the right thing.
  const committed = committedSegments(run);

  for (const uri of caseDef.must_use) {
    if (!containsLoose(trace, uri))
      failures.push({ check: 'must_use', pattern: uri, message: `must_use not referenced anywhere in trace: ${uri}` });
  }

  for (const pat of caseDef.must_not_contain) {
    for (const seg of committed) {
      const hit = findLoose(seg.text, pat);
      if (!hit) continue;
      failures.push({
        check: 'must_not_contain',
        pattern: pat,
        where: seg.where,
        matched: hit.match,
        context: hit.context,
        message: `must_not_contain matched in ${seg.where}: ${pat}`,
      });
      break; // one report per pattern is enough to fail it
    }
  }

  if (caseDef.expect_receipt && !hasReceipt(run.answer))
    failures.push({ check: 'expect_receipt', message: 'missing AGT-1 provenance receipt (Basis: … | Freshness: …)' });

  // AGT-3: where the correct answer is a routing DECISION, spending queries on
  // it is itself the failure. Eval cost is a sensor for protocol waste — every
  // real user asking the same question pays what this case pays.
  if (caseDef.max_malloy_calls != null) {
    const spent = run.malloy_tool_calls ?? 0;
    if (spent > caseDef.max_malloy_calls)
      failures.push({
        check: 'max_malloy_calls',
        message: `spent ${spent} Malloy tool call(s), budget is ${caseDef.max_malloy_calls} — ` +
          `the answer should be reachable without querying the models`,
      });
  }

  return failures;
}

// ---- entry point ------------------------------------------------------------
// ctx: { runQuery(text) -> {rows} }
async function grade(caseDef, run, ctx) {
  // The agent never answered. Not a wrong answer — no answer, so there is no
  // behaviour to score. `errored` runs are excluded from the quorum rather than
  // counted as failures: grading an "API Error: 529" as a case that routed to
  // no concepts is how infrastructure noise turns into a product verdict.
  if (run.transport_error)
    return {
      pass: false, errored: true, kind_pass: null, matches: null,
      detail: `not graded — the agent never answered: ${run.transport_error.reason}`,
      extracted: null, receipt_present: false, cross_checks: [],
    };

  if (run.error && !run.answer)
    return {
      pass: false, kind_pass: false, matches: null,
      detail: `agent run failed: ${run.error}`,
      extracted: null, receipt_present: false, cross_checks: [],
    };

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
  const detail = [kindResult.detail, ...xs.map((x) => x.message)].filter(Boolean).join(' | ');

  return {
    pass,
    // Which LAYER failed, kept separate from the joined prose. A run that fails
    // its kind and a run that fails a cross-check are two different failures,
    // and telling them apart is what lets the correlation check ask whether two
    // lanes failed for the same reason (EVAL-12 correlation).
    kind_pass: kindResult.pass,
    matches: kindResult.matches || null,
    detail,
    extracted,
    receipt_present: hasReceipt(run.answer),
    cross_checks: xs,
  };
}

module.exports = {
  grade, extractNumber, hasReceipt, crossChecks, containsLoose, findLoose,
  committedSegments, withinTolerance, REFUSAL_MARKERS,
};
