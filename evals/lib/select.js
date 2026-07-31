// =============================================================================
// select.js — EVAL-12b: run only the cases a change could have moved.
//
//   EVAL-6 already answers "is this the same product?" for the whole repo. That
//   is too coarse to select with: editing one concept changes the semantic
//   identity, so every case would be re-measured for a definition only one of
//   them routes to. This narrows the same idea to ONE CASE — a fingerprint over
//   the inputs that case's verdict can actually depend on:
//
//     the case file          question, gold query, cross-checks
//     its must_use concepts  their definitions and membership rules, plus
//                            whatever they are declared `of:` / `subtype_of:`
//     the routing SURFACE    which concept URIs exist, at which kind and status
//     the standing hints     kp/agent/examples.md, corrections.md (EVAL-8 keeps
//                            these IN the meaning: the agent acts on them)
//     models/, CLAUDE.md,    shared by every case, so any edit here selects
//     the runtime            everything — which is the safe direction
//
//   A case is then SKIPPED when the ledger of past results already holds a
//   clean measurement at this exact fingerprint: enough passing runs, and not
//   one failing or errored run. "Plus last run's failures" needs no special
//   case — a failure is simply never evidence.
//
//   Two deliberate refusals, both because a false skip is invisible:
//
//   1. A case with no `must_use` is NEVER skipped. Its concept dependencies are
//      undeclared, so nothing here can tell whether the definition someone just
//      edited is one the case routes to. `must_use` is a declaration of
//      dependency, and only a case that makes it can be selected out.
//   2. The routing surface is `uri|kind|status`, NOT the generated
//      `kp/index.md`. The index is a projection of the concept files, so
//      digesting it whole would make every definition edit select every case
//      and the mechanism would do nothing. What genuinely does reach every
//      case is a concept APPEARING, disappearing, or becoming approved: that
//      changes what any question can route to, and it is what the surface
//      digest catches.
// =============================================================================
const fs = require('fs');
const path = require('path');

const { fileDigest, sha256 } = require('./identity');

// Standing hints the agent reads and acts on. EVAL-8 kept these inside the
// semantic identity for exactly this reason: editing them can move a number, so
// they are a dependency of every case.
const HINT_FILES = ['agent/examples.md', 'agent/corrections.md'];

const digestOf = (p) => (fs.existsSync(p) ? fileDigest(p, p, true) : sha256('(absent)'));

// Which concepts exist, at which kind and status. Deliberately NOT their
// definitions: a definition edit is the business of the cases that use it, an
// addition/removal/approval is everyone's.
function surfaceDigest(canon) {
  const lines = Object.keys(canon).sort()
    .map((u) => `${u}|${canon[u].kind}|${canon[u].status}`);
  return sha256(lines.join('\n'));
}

const hintsDigest = (kpDir) =>
  sha256(HINT_FILES.map((f) => `${f}:${digestOf(path.join(kpDir, f))}`).join('\n'));

// A concept's meaning leans on what it is declared to be a kind OF, and on the
// entity it hangs off. Edit kp:Customer and kp:ActiveCustomer's membership rule
// can mean something different without its own file changing a byte.
function conceptDeps(uris, canon) {
  const seen = new Set();
  const stack = [...uris];
  while (stack.length) {
    const u = stack.pop();
    if (seen.has(u)) continue;
    seen.add(u);
    const c = canon[u];
    if (!c) continue;                         // unknown URI: recorded as absent below
    for (const t of [c.subtype_of, c.of]) if (t) stack.push(t);
  }
  return [...seen].sort();
}

// The per-sweep half of the fingerprint, computed once.
//
// `modelsDigest` and `protocolDigest` are PASSED IN from semanticIdentity
// rather than recomputed. Two functions that must agree about the same tree is
// the EVAL-8 shape, and there is no reason to have two.
function planeContext({ kpDir, canon, modelsDigest, protocolDigest, runtimeSettings = {} }) {
  return {
    canon,
    kpDir,
    surface: surfaceDigest(canon),
    hints: hintsDigest(kpDir),
    models: modelsDigest,
    protocol: protocolDigest,
    runtime: JSON.stringify(runtimeSettings, Object.keys(runtimeSettings).sort()),
  };
}

// The components are labelled and newline-joined so a fingerprint can be
// explained when it moves — an opaque hash that changed for an unknown reason
// is a mechanism nobody will trust enough to act on.
function fingerprintParts(c, ctx) {
  return [
    `case:${digestOf(c._path)}`,
    ...conceptDeps(c.must_use, ctx.canon).map((u) => {
      const meta = ctx.canon[u];
      const p = meta ? path.join(ctx.kpDir, meta._path) : null;
      return `concept:${u}:${p ? digestOf(p) : '(absent)'}`;
    }),
    `surface:${ctx.surface}`,
    `hints:${ctx.hints}`,
    `models:${ctx.models}`,
    `protocol:${ctx.protocol}`,
    `runtime:${ctx.runtime}`,
  ];
}

const caseFingerprint = (c, ctx) => 'sha256:' + sha256(fingerprintParts(c, ctx).join('\n'));

// A case whose dependencies are undeclared cannot be selected out.
const skippable = (c) => c.must_use.length > 0;

// ---- the ledger --------------------------------------------------------------
// One key per (fingerprint, lane, data, model). The fingerprint says what the
// case MEANS; these three say what it was measured against, and a tier-1 pass
// is not evidence about tier 2 any more than a fixtures pass is evidence about
// live data. One function, called with both a past row and a planned run, so
// the two can never drift apart.
const evidenceKey = ({ fingerprint, tier, data_source, model_id }) =>
  [fingerprint, `tier${tier}`, data_source || '?', model_id || 'default'].join('|');

// Result rows carry no `kind`; every meta line (run_meta, selection) does. That
// is the only thing separating them, so skipped-case records can never be read
// back as measurements of themselves.
const isResultRow = (o) => !!o && !o.kind && !!o.case;

function loadLedger(dir) {
  const ledger = new Map();
  if (!fs.existsSync(dir)) return ledger;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      let o;
      try { o = JSON.parse(t); } catch { continue; }
      if (!isResultRow(o) || !o.case_fingerprint) continue;   // pre-EVAL-12b rows
      const key = evidenceKey({
        fingerprint: o.case_fingerprint, tier: o.tier,
        data_source: o.data_source, model_id: o.model_id,
      });
      const e = ledger.get(key) || { case: o.case, passed: 0, failed: 0, errored: 0, files: [] };
      if (o.errored) e.errored++;
      else if (o.pass) e.passed++;
      else e.failed++;
      if (!e.files.includes(f)) e.files.push(f);
      e.last_ts = o.ts || e.last_ts;
      ledger.set(key, e);
    }
  }
  return ledger;
}

// ---- the decision ------------------------------------------------------------
// Returns one entry per case, in the order given, always with a fingerprint —
// selection may be off, but the fingerprint still travels on every result row
// so that THIS sweep becomes evidence for the next one.
function selectCases(cases, { ctx, ledger = null, runs = 3, laneOf = (c) => c.tier, dataSource, modelId }) {
  return cases.map((c) => {
    const fingerprint = caseFingerprint(c, ctx);
    const tier = laneOf(c);
    const base = { case: c.name, fingerprint, tier };
    if (!ledger) return { ...base, skip: false, reason: 'selection off' };
    if (!skippable(c))
      return { ...base, skip: false, reason: 'declares no must_use — its concept dependencies are undeclared' };

    const key = evidenceKey({ fingerprint, tier, data_source: dataSource, model_id: modelId });
    const e = ledger.get(key);
    if (!e) return { ...base, skip: false, reason: 'never measured at this fingerprint' };
    // A case that has ever failed or errored at this exact fingerprint is not
    // settled — that is where "plus last run's failures" comes from, and it also
    // refuses to average a flaky case into a pass.
    if (e.failed || e.errored)
      return {
        ...base, skip: false, evidence: e,
        reason: `${e.failed} failing / ${e.errored} errored run(s) at this fingerprint`,
      };
    if (e.passed < runs)
      return {
        ...base, skip: false, evidence: e,
        reason: `only ${e.passed} passing run(s) on record, ${runs} required`,
      };
    return {
      ...base, skip: true, evidence: e,
      reason: `${e.passed} passing run(s), unchanged since ${e.files[e.files.length - 1]}`,
    };
  });
}

module.exports = {
  planeContext, caseFingerprint, fingerprintParts, selectCases, loadLedger,
  evidenceKey, isResultRow, surfaceDigest, conceptDeps, skippable, HINT_FILES,
};
