// =============================================================================
// agent.js — drive the agent under test, headless.
//
//   The point of the whole loop: run the SHIPPED protocol, not a stub. The
//   subprocess starts in the repo root, so it picks up the real CLAUDE.md and
//   the real kp/ bundle exactly as a user's session would. Nothing here injects
//   guidance; if the routing rules are wrong, the eval must be able to see it.
//
//   We ask for stream-json because the final text alone cannot answer the
//   question the tier-boundary cases are really asking — "what Malloy did it
//   run?" lives in the tool calls, not the prose.
//
//   Tools are restricted to read + Malloy execution. An eval sweep is N runs x
//   M cases; if the agent under test could write, it would append to
//   question-log.md a few dozen times and dirty the tree that OPS-1 gates on.
//   Log-append INTENT is still observable in the trace as a denied tool call.
// =============================================================================
const { spawn } = require('child_process');

const AGENT_BIN = process.env.EVAL_AGENT_BIN || 'claude';

// The Malloyyo tools are here because RUN_TOOLS already recognises
// `mcp__claude_ai_Malloyyo__query`: without them a Malloyyo-backed sweep would
// be blocked at the tool gate and every case would fail for a reason that has
// nothing to do with the protocol. `describe_source` / `list_sources` come with
// it — CLAUDE.md requires inspect-before-run, so allowing the query alone would
// leave the runtime broken in a different way.
const ALLOWED_TOOLS = [
  'Read', 'Glob', 'Grep',
  'mcp__malloy__compile', 'mcp__malloy__compile_file', 'mcp__malloy__run',
  'mcp__malloy__run_file', 'mcp__malloy__language_help', 'mcp__malloy__list_runs',
  'mcp__claude_ai_Malloyyo__query', 'mcp__claude_ai_Malloyyo__describe_source',
  'mcp__claude_ai_Malloyyo__list_sources',
];
const DISALLOWED_TOOLS = ['Write', 'Edit', 'NotebookEdit', 'Bash'];

// Tool calls that actually EXECUTE Malloy — these are the agent's answer-
// producing queries. Compiles are routing evidence but produce no number.
const RUN_TOOLS = new Set(['mcp__malloy__run', 'mcp__malloy__run_file', 'mcp__claude_ai_Malloyyo__query']);
const MALLOY_TOOLS = new Set([...RUN_TOOLS, 'mcp__malloy__compile', 'mcp__malloy__compile_file']);

// ---- transport failures are not answers -------------------------------------
// The CLI reports an API failure in the SAME envelope shape as a successful
// reply: the error text arrives in `result`, so a 529 reaches the grader as an
// answer reading "API Error: 529 Overloaded", which grades as a case that
// routed to no concepts and ran no Malloy. Found the hard way — the first real
// correlation run reported `refusal-routing-decision` as a lane disagreement
// when the only difference between the lanes was which calls got a 529.
//
// The distinction that matters: a transport error means the agent NEVER
// ANSWERED, so there is no behaviour to grade. A reply that fails to parse, or
// hits the turn cap, IS behaviour and stays a genuine failure.
const TRANSPORT_FIRST_LINE =
  /^(?:API Error:\s*(\d{3})?|Overloaded|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed|Error: connect\b)/i;

function transportErrorOf(text) {
  const first = String(text || '').split('\n').map((s) => s.trim()).find(Boolean) || '';
  const m = TRANSPORT_FIRST_LINE.exec(first);
  if (!m) return null;
  const status = m[1] ? Number(m[1]) : null;
  return {
    reason: first.slice(0, 200),
    status,
    // 401/403 will not fix themselves; 429 and 5xx are why the retry exists.
    retryable: status == null || status === 429 || status >= 500,
  };
}

// Malloy text hides under a different key per tool surface.
const queryTextOf = (input) => {
  if (!input || typeof input !== 'object') return null;
  for (const k of ['source', 'query', 'malloy', 'text', 'sql']) {
    if (typeof input[k] === 'string' && input[k].trim()) return input[k];
  }
  // run_file: no inline text, record what was selected instead
  if (input.uri || input.file) return `(file) ${input.uri || input.file}${input.name ? ' :: ' + input.name : ''}`;
  return null;
};

// The question goes in over STDIN, never on the command line. `claude` is a
// .cmd shim on Windows, which forces spawn(shell:true), and a shell concatenates
// argv rather than escaping it — a question containing spaces arrives as its
// first word alone. (Observed: "What is our customer lifetime value?" reached
// the agent as "What".) Only static flags are interpolated here.
function buildCommand({ model, maxTurns }) {
  const parts = [
    AGENT_BIN, '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--allowedTools', `"${ALLOWED_TOOLS.join(',')}"`,
    '--disallowedTools', `"${DISALLOWED_TOOLS.join(',')}"`,
  ];
  if (model) parts.push('--model', model);
  if (maxTurns) parts.push('--max-turns', String(maxTurns));
  return parts.join(' ');
}

function parseStream(stdout) {
  const messages = [];
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try { messages.push(JSON.parse(t)); } catch { /* partial line — ignore */ }
  }
  return messages;
}

// Pull everything the grader needs out of the raw message stream.
function extract(messages) {
  const toolCalls = [];       // every tool_use, in order
  const executedMalloy = [];  // just the ones that ran a query
  const textParts = [];       // assistant prose — what the agent WROTE
  const resultParts = [];     // tool results — what the agent READ
  let final = null;
  let usage = null;
  let costUsd = null;
  let durationMs = null;
  let numTurns = null;
  let sessionId = null;
  let errorSubtype = null;

  for (const m of messages) {
    if (m.type === 'system' && m.session_id) sessionId = m.session_id;

    if (m.type === 'assistant' && m.message && Array.isArray(m.message.content)) {
      for (const block of m.message.content) {
        if (block.type === 'text' && block.text) textParts.push(block.text);
        if (block.type === 'tool_use') {
          const q = queryTextOf(block.input);
          toolCalls.push({ name: block.name, query: q, input: block.input });
          if (RUN_TOOLS.has(block.name) && q) executedMalloy.push(q);
        }
      }
    }

    // tool results carry errors (e.g. a denied write, a compile failure) that
    // explain a failing case — keep them in the trace text.
    if (m.type === 'user' && m.message && Array.isArray(m.message.content)) {
      for (const block of m.message.content) {
        if (block.type === 'tool_result') {
          const c = block.content;
          const s = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => x.text || '').join('\n') : '';
          if (s) resultParts.push(`[tool_result]${block.is_error ? '[error]' : ''} ${s}`);
        }
      }
    }

    if (m.type === 'result') {
      final = typeof m.result === 'string' ? m.result : null;
      usage = m.usage || null;
      costUsd = m.total_cost_usd ?? null;
      durationMs = m.duration_ms ?? null;
      numTurns = m.num_turns ?? null;
      sessionId = m.session_id || sessionId;
      if (m.is_error || (m.subtype && m.subtype !== 'success')) errorSubtype = m.subtype || 'error';
    }
  }

  const answer = final != null ? final : textParts.join('\n\n');

  // What the agent WROTE: its prose plus every query it authored, compiles
  // included. Kept for debugging a trace; NOT the must_not_contain surface —
  // that grades `answer` + `executedMalloy` only (see grade.js, EVAL-7), because
  // an expression compiled and then discarded was never committed to.
  const authoredText = [
    answer,
    ...textParts,
    ...toolCalls.map((t) => `${t.name} ${t.query || JSON.stringify(t.input || {})}`),
  ].join('\n');

  // Everything, including what came BACK from tools. A concept can be reached
  // for in a query without being named in the prose, so must_use searches here.
  const traceText = [authoredText, ...resultParts].join('\n');

  const tokens = usage
    ? (usage.input_tokens || 0) + (usage.output_tokens || 0) +
      (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0)
    : null;

  return {
    answer, traceText, authoredText, textParts, toolCalls, executedMalloy, tokens, usage,
    cost_usd: costUsd, agent_duration_ms: durationMs, num_turns: numTurns,
    session_id: sessionId, error: errorSubtype,
    malloy_tool_calls: toolCalls.filter((t) => MALLOY_TOOLS.has(t.name)).length,
  };
}

// Resolve, never reject: a crashed or timed-out agent is a FAILING case with a
// recorded reason, not a crashed sweep.
function ask({ question, model = null, maxTurns = 30, timeoutMs = 300000, cwd = process.cwd() }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(buildCommand({ model, maxTurns }), {
      cwd,
      shell: true,
      env: process.env,
    });

    // the whole question, unmangled, then EOF so the agent starts work
    child.stdin.on('error', () => { /* closed early — surfaced via exit code */ });
    child.stdin.write(question);
    child.stdin.end();

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({
        answer: '', traceText: '', toolCalls: [], executedMalloy: [], tokens: null,
        latency_ms: Date.now() - started,
        error: `agent could not be started (${AGENT_BIN}): ${e.message}`,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const latency = Date.now() - started;
      const messages = parseStream(stdout);
      const out = extract(messages);
      out.latency_ms = latency;
      if (timedOut) out.error = `timed out after ${timeoutMs}ms`;
      else if (code !== 0 && !out.answer) out.error = out.error || `agent exited ${code}: ${stderr.trim().slice(0, 400)}`;
      const te = transportErrorOf(out.answer);
      if (te) {
        out.transport_error = te;
        out.error = out.error || te.reason;
      }
      resolve(out);
    });
  });
}

module.exports = {
  ask, extract, parseStream, transportErrorOf,
  ALLOWED_TOOLS, DISALLOWED_TOOLS, RUN_TOOLS, AGENT_BIN,
};
