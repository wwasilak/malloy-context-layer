// =============================================================================
// tier1.js — the cheap lane (EVAL-12a / SIMP-1).
//
//   Most cases test a DECISION, not a trajectory: which governed concepts does
//   this question resolve to, and what Malloy follows from their bindings? That
//   decision is made on turn one. Watching it play out over twenty agentic
//   turns costs ~600k tokens to observe something that was settled in the
//   first, and drags in the whole trajectory-parsing layer — which is where
//   both bugs found in review (EVAL-7 scope, EVAL-11 extraction) lived.
//
//   So: one call, no tools, structured JSON out. The agent says which concepts
//   it routed to and what query it WOULD run; the harness runs that query
//   itself, against the same fixtures, and compares to gold exactly as before.
//   No tools are needed to test a routing decision — only to carry it out.
//
//   Deliberately NOT changed:
//     - CLAUDE.md. It is auto-discovered from the working directory here, the
//       same way it reaches a real session. Tier 1 differs from tier 2 in
//       TOOLS and TURNS and nothing else, which is what makes the correlation
//       check meaningful. EVAL-11's warning stands: do not reshape the product
//       to suit the grader. The output contract below lives in the harness.
//
//   The prompt states one thing the routing table does not: that a Binding of
//   `model.source.field` is queried as `run: source -> { ... }`. That is not a
//   hint about the ANSWER — it is notation the compiler teaches a tier-2 agent
//   on its first call and which tier 1 has no way to learn, having had the
//   compiler taken away. Observed: the first tier-1 run routed perfectly and
//   then wrote `run: sales.sales_performance`, copying the table verbatim.
//   Compensate in the harness for context the harness removed; never in
//   CLAUDE.md.
//     - the grader. This returns the same run shape agent.js does, so
//       grade.js, the cross-checks and query_shape grading are untouched.
//
//   THE COMPILE-REPAIR ROUND, and why it exists. A tier-2 agent that writes a
//   query, sees it fail to compile, fixes it and answers correctly is behaving
//   WELL — iterating against the compiler is the protocol, not a mistake. With
//   one call and no tools, the same agent fails on dialect recall alone. Both
//   observed on the first tier-1 runs: `run: sales.sales_performance` (copying
//   the table's model.source.field notation) and `where: is_active_customer`
//   (an aggregate that needs `having:`). Neither is a routing error; a tier-2
//   agent fixes both on the next turn.
//
//   So tier 1 gets ONE repair round: the harness compiles the proposed query,
//   and on failure hands the compiler's own message back and asks for a
//   correction. That is not the trajectory layer returning — it is bounded,
//   harness-driven, and machine-generated, with no tools and no free-form
//   turns. It makes tier 1 grade the DECISION (which concepts, which binding)
//   instead of dialect memory, which is the only reason the tier is worth
//   having. Repairs are counted on every row: a case that always needs one is
//   telling you something about the protocol, not about the harness.
// =============================================================================
const fs = require('fs');
const { spawn } = require('child_process');

const AGENT_BIN = process.env.EVAL_AGENT_BIN || 'claude';
const KP_INDEX = process.env.KP_INDEX || 'kp/index.md';

// With no tools the agent cannot Read the routing table, so it is supplied.
// This is the ONLY context injected: everything else (the protocol itself)
// arrives the way it does in production.
function buildPrompt({ question, routingTable }) {
  return `You are answering a question against the Knowledge Plane, following the
protocol in CLAUDE.md exactly as you normally would.

You have NO TOOLS on this turn. You cannot read files or run queries. The
routing table you would normally read from kp/index.md is reproduced in full
below. Decide the answer from it.

Reply with ONE fenced json block and nothing else:

\`\`\`json
{
  "concepts": ["kp:ConceptYouRoutedTo"],
  "malloy": "run: source -> { aggregate: bound_measure }",
  "answer": "the answer you would give, including the Basis/Freshness/Steward receipt",
  "governed": true
}
\`\`\`

Notation. The table's Binding column is written model.source.field. A Malloy
query runs against the SOURCE, so a binding of
\`sales.sales_performance.average_order_value\` is written:

    run: sales_performance -> { aggregate: average_order_value }

Do not prefix the source with the model name; that is where the binding lives,
not part of the query.

Field rules:
- "concepts": every governed concept URI the answer resolves to, exactly as
  written in the routing table. Empty list if the term is not governed.
- "malloy": the query you would execute, using the bindings from the table.
  Use null if answering correctly requires no query at all.
- "answer": what you would tell the user. Apply the same rules you always do,
  including the answer receipt.
- "governed": false when the question is about a term the routing table does
  not contain.

--- ROUTING TABLE (kp/index.md) ---
${routingTable}
--- END ROUTING TABLE ---

QUESTION: ${question}`;
}

// The repair round. Stateless on purpose — the whole context is restated, so
// no session has to be resumed and the call stays a single independent turn.
function buildRepairPrompt({ question, routingTable, previous, error }) {
  return `${buildPrompt({ question, routingTable })}

--- YOUR PREVIOUS REPLY ---
${previous}
--- END PREVIOUS REPLY ---

That query did not run. The Malloy compiler reported:

    ${error}

Fix the query and reply with the same json block. Keep the routing decision —
the concepts and bindings — unless the error shows it was wrong; this is a
dialect correction, not a re-think. Recall from the protocol: filter measures
with \`having:\` and dimensions with \`where:\`, use \`count(x)\` for a distinct
count, and \`is not null\` rather than \`!= null\`.`;
}

// The model is asked for one fenced json block, but "reply with only X" is a
// request, not a guarantee. Accept a bare object too, and fail loudly rather
// than silently grading an unparsed answer as empty.
function parseJsonBlock(text) {
  const s = String(text || '');
  const fence = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(s);
  const candidates = [];
  if (fence) candidates.push(fence[1]);
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(s.slice(first, last + 1));
  for (const c of candidates) {
    try { return { data: JSON.parse(c), error: null }; } catch { /* try next */ }
  }
  return { data: null, error: 'no parseable JSON object in the reply' };
}

const toArray = (v) => (Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)]);

// Map the structured reply onto the run shape grade.js already consumes.
// `executedMalloy` holds what the agent COMMITTED to running — the harness
// executes it. malloy_tool_calls counts proposed queries, so AGT-3's
// max_malloy_calls budget keeps its meaning here: proposing a query to answer a
// pure routing question is still spending one.
function toRun(parsed, raw) {
  const queries = parsed && parsed.malloy ? [String(parsed.malloy)] : [];
  const concepts = parsed ? toArray(parsed.concepts) : [];
  const answer = parsed ? String(parsed.answer || '') : String(raw || '');
  return {
    answer,
    executedMalloy: queries,
    // Everything the run touched. Concepts are named explicitly rather than
    // inferred from prose, which makes must_use a cleaner check than it is on a
    // trajectory.
    traceText: [answer, concepts.join('\n'), ...queries].join('\n'),
    authoredText: [answer, ...queries].join('\n'),
    toolCalls: [],
    malloy_tool_calls: queries.length,
    tier1_concepts: concepts,
    tier1_governed: parsed ? parsed.governed !== false : null,
  };
}

function buildCommand({ model }) {
  const parts = [
    AGENT_BIN, '-p',
    '--output-format', 'json',
    '--max-turns', '1',
    // No MCP servers, and every built-in denied: tier 1 is a decision, and a
    // tool call here would mean the lane is not doing what it claims.
    '--strict-mcp-config',
    '--disallowedTools', '"Read,Glob,Grep,Bash,Write,Edit,NotebookEdit,WebFetch,WebSearch,Task,TodoWrite"',
  ];
  if (model) parts.push('--model', model);
  return parts.join(' ');
}

// One turn. Resolves to { envelope, error } — never rejects.
function oneCall({ prompt, model, timeoutMs, cwd }) {
  return new Promise((resolve) => {
    const child = spawn(buildCommand({ model }), { cwd, shell: true, env: process.env });
    child.stdin.on('error', () => {});
    child.stdin.write(prompt);
    child.stdin.end();

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ envelope: null, error: `agent could not be started (${AGENT_BIN}): ${e.message}` });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      let envelope = null;
      try { envelope = JSON.parse(stdout.trim()); } catch { /* handled by caller */ }
      resolve({
        envelope,
        error: timedOut ? `timed out after ${timeoutMs}ms`
          : envelope ? null
          : `agent produced no JSON envelope (exit ${code}): ${stderr.trim().slice(0, 400)}`,
      });
    });
  });
}

const sumTokens = (u) => (u
  ? (u.input_tokens || 0) + (u.output_tokens || 0) +
    (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
  : 0);

// Resolve, never reject — same contract as agent.ask().
//
// `validate(malloyText)` -> null when the query runs, or an error string. The
// runner passes the same executor the grader uses, so the repair round sees the
// identical compiler the grade will be based on. Omit it and there is no repair
// round, which is what the unit tests use.
async function askTier1({
  question, model = null, timeoutMs = 120000, cwd = process.cwd(),
  kpIndex = KP_INDEX, validate = null, maxRepairs = 1,
}) {
  const started = Date.now();
  const fail = (error) => ({
    answer: '', traceText: '', executedMalloy: [], toolCalls: [], tokens: null,
    malloy_tool_calls: 0, tier: 1, repairs: 0, latency_ms: Date.now() - started, error,
  });

  let routingTable;
  try {
    routingTable = fs.readFileSync(kpIndex, 'utf8');
  } catch (e) {
    return fail(`could not read routing table ${kpIndex}: ${e.message}`);
  }

  let prompt = buildPrompt({ question, routingTable });
  let envelope = null;
  let parsed = null;
  let parseError = null;
  let repairs = 0;
  let cost = 0;
  let tokens = 0;
  let lastCompileError = null;

  for (let attempt = 0; ; attempt++) {
    const res = await oneCall({ prompt, model, timeoutMs, cwd });
    if (!res.envelope) return fail(res.error);
    envelope = res.envelope;
    cost += envelope.total_cost_usd ?? 0;
    tokens += sumTokens(envelope.usage);

    const p = parseJsonBlock(envelope.result);
    parsed = p.data;
    parseError = p.error;

    // Repair only a query that FAILS TO RUN. A wrong-but-runnable query is a
    // wrong decision and must be graded as one, not coached into agreement.
    if (attempt >= maxRepairs || !validate || !parsed || !parsed.malloy) break;
    const err = await validate(String(parsed.malloy));
    if (!err) { lastCompileError = null; break; }
    lastCompileError = err;
    repairs++;
    prompt = buildRepairPrompt({ question, routingTable, previous: envelope.result, error: err });
  }

  const run = toRun(parsed, envelope.result);
  run.tokens = tokens || null;
  run.usage = envelope.usage || null;
  run.cost_usd = cost || null;
  run.num_turns = (envelope.num_turns ?? 1) + repairs;
  run.session_id = envelope.session_id || null;
  run.latency_ms = Date.now() - started;
  run.agent_duration_ms = envelope.duration_ms ?? null;
  run.tier = 1;
  run.repairs = repairs;
  run.last_compile_error = lastCompileError;
  // A reply we could not parse is a FAILING run with a reason, never a
  // silently empty one that the grader scores as "said nothing".
  run.error = envelope.is_error ? (envelope.subtype || 'error') : parseError || null;
  return run;
}

module.exports = {
  askTier1, buildPrompt, buildRepairPrompt, parseJsonBlock, toRun, AGENT_BIN,
};
