// =============================================================================
// correlate.js — does the cheap lane agree with the expensive one? (EVAL-12)
//
//   Tier 1 is a PROXY. It runs the same question with no tools and one turn and
//   claims the verdict would have been the same. That claim is the whole basis
//   for making the suite cheap, and nothing checks it. EVAL-12's invariant:
//
//     every cheap tier must be periodically validated against the expensive
//     tier it replaces, or you get a green suite over a wrong product.
//
//   This module is the arithmetic of that validation, kept pure so it can be
//   tested without spending a cent. The CLI (`evals/correlate.js`) runs the two
//   lanes and hands the rows here.
//
//   THE ASYMMETRY THAT MATTERS. Both disagreement directions break the proxy,
//   but only one of them is dangerous:
//
//     FALSE GREEN (tier 1 passes, tier 2 fails) — the suite certifies behaviour
//       the real agent does not exhibit. This is the failure mode the invariant
//       exists to prevent: nobody looks at a green suite.
//     FALSE RED (tier 1 fails, tier 2 passes) — the cheap lane fails a product
//       that is fine. Loud, not silent, and self-correcting; the case belongs
//       back on tier 2 (membership-verbatim is the worked example). Still a
//       broken proxy, so still a gate failure.
//
//   BOTH FAILING IS NOT AGREEMENT. Two lanes can fail the same case for
//   unrelated reasons and look correlated. That is why `kind_pass` and the
//   cross-check names travel on every row: a shared verdict with different
//   reasons establishes nothing and is reported as inconclusive, never as
//   evidence the proxy works.
//
//   WHAT MUST BE TRUE FOR THE COMPARISON TO MEAN ANYTHING. Both lanes must have
//   run against the same semantic identity (EVAL-6) and the same data. Compare
//   a tier-1 run from today with a tier-2 run from last week and you are
//   measuring the difference between two products, not two lanes.
// =============================================================================

// What counts as a measurement: a result row carries no `kind`, every meta line
// (run_meta, selection) does. Shared with select.js so there is one definition —
// a skipped case must never be read back as evidence about itself.
const { isResultRow } = require('./select');

// A case's verdict in one lane, and the direction the pair disagrees in.
const CLASS = {
  AGREE_PASS: 'AGREE_PASS',
  AGREE_FAIL_SAME: 'AGREE_FAIL_SAME',
  AGREE_FAIL_DIFFERENT: 'AGREE_FAIL_DIFFERENT',
  FALSE_GREEN: 'FALSE_GREEN',
  FALSE_RED: 'FALSE_RED',
  INCOMPLETE: 'INCOMPLETE',
};

// Only AGREE_PASS establishes that the cheap lane is a valid stand-in: it is
// the only outcome where tier 1 certified something and tier 2 confirms it.
const ESTABLISHES = new Set([CLASS.AGREE_PASS]);
const DISAGREEMENTS = new Set([CLASS.FALSE_GREEN, CLASS.FALSE_RED]);

// Why a run failed, as a comparison key rather than a sentence. Cross-check
// names identify the check that fired (must_use, must_not_contain, …); `kind`
// means the artifact itself was wrong. Rows written before this field existed
// report `?`, which never compares equal to anything — an unknown reason must
// not pass for a matching one.
function reasonKey(row) {
  if (row.pass) return null;
  const checks = [...new Set((row.cross_checks || []).map((x) => x.check))].sort();
  const kind = row.kind_pass === false ? ['kind']
    : row.kind_pass == null ? ['?']
    : [];
  const parts = [...kind, ...checks];
  return parts.length ? parts.join('+') : 'unknown';
}

const sum = (rows, f) => rows.reduce((a, r) => a + (f(r) || 0), 0);

// One lane's verdict for one case. The quorum rule is the runner's: a case
// passes a lane only if it passes on a quorum of that lane's runs, so a lane
// that is merely flaky never counts as agreeing.
//
// Runs that never produced an answer are excluded, and a lane with fewer
// completed runs than the quorum has NO verdict — it is `present: false`, which
// classifies the pair as INCOMPLETE. Scoring the survivors would let one lane's
// bad luck with the API read as a disagreement with the other lane: the first
// real correlation run reported a FALSE_RED that was three 529s.
function laneVerdict(rows, quorum = null) {
  const errored = rows.filter((r) => r.errored).length;
  const usable = rows.filter((r) => !r.errored);
  const total = usable.length;
  const passed = usable.filter((r) => r.pass).length;
  const measured = total > 0 && (quorum == null || total >= quorum);
  return {
    present: measured,
    total,
    errored,
    passed,
    pass: measured && passed >= (quorum == null ? total : quorum),
    flaky: passed > 0 && passed < total,
    reasons: [...new Set(usable.map(reasonKey).filter(Boolean))].sort(),
    match_tiers: [...new Set(usable.flatMap((r) => r.match_tiers || []))].sort(),
    // Cost counts every run, answered or not — a 529 is cheap but not free.
    cost_usd: sum(rows, (r) => r.cost_usd),
    tokens: sum(rows, (r) => r.tokens),
    malloy_calls: sum(usable, (r) => r.malloy_tool_calls),
    repairs: sum(usable, (r) => r.repairs),
  };
}

const sameReasons = (a, b) =>
  a.length > 0 && a.length === b.length && a.every((r, i) => r === b[i]) && !a.includes('?');

function classify(t1, t2) {
  if (!t1.present || !t2.present) return CLASS.INCOMPLETE;
  if (t1.pass && t2.pass) return CLASS.AGREE_PASS;
  if (t1.pass && !t2.pass) return CLASS.FALSE_GREEN;
  if (!t1.pass && t2.pass) return CLASS.FALSE_RED;
  return sameReasons(t1.reasons, t2.reasons) ? CLASS.AGREE_FAIL_SAME : CLASS.AGREE_FAIL_DIFFERENT;
}

// What the classification MEANS depends on what the case claims.
//
//   declared tier 1 — the case is run cheap in the normal sweep, so its verdict
//     rests on this proxy. Any disagreement, and any pair we could not complete,
//     fails the check.
//   declared tier 2 — nothing is claiming to replace it; running it cheap is a
//     PROBE asking whether it could be promoted. A probe never fails the gate,
//     it just answers eligible / not eligible.
function verdictFor(klass, declaredTier) {
  const probe = declaredTier !== 1;
  if (probe) {
    return {
      gate: 'ok',
      probe: true,
      eligible: klass === CLASS.AGREE_PASS,
      establishes: false,
      note: klass === CLASS.AGREE_PASS
        ? 'behaves identically in both lanes — candidate for tier 1'
        : klass === CLASS.INCOMPLETE
          ? 'not enough runs to judge'
          : 'stays on tier 2 — the cheap lane does not reproduce the tier-2 verdict',
    };
  }
  switch (klass) {
    case CLASS.AGREE_PASS:
      return { gate: 'ok', probe: false, establishes: true, note: 'both lanes pass' };
    case CLASS.FALSE_GREEN:
      return {
        gate: 'fail', probe: false, establishes: false,
        note: 'tier 1 PASSES what tier 2 FAILS — the cheap lane certifies behaviour the real agent does not exhibit',
      };
    case CLASS.FALSE_RED:
      return {
        gate: 'fail', probe: false, establishes: false,
        note: 'tier 1 FAILS what tier 2 PASSES — the case needs the trajectory; move it back to tier 2',
      };
    case CLASS.AGREE_FAIL_SAME:
      return {
        gate: 'warn', probe: false, establishes: false,
        note: 'both lanes fail for the same reason — consistent, but a red case proves nothing about the proxy',
      };
    case CLASS.AGREE_FAIL_DIFFERENT:
      return {
        gate: 'warn', probe: false, establishes: false,
        note: 'both lanes fail for DIFFERENT reasons — the same verdict by coincidence is not agreement',
      };
    default:
      return {
        gate: 'fail', probe: false, establishes: false,
        note: 'a lane has no measured verdict (too few runs answered) — nothing was compared, so re-run rather than read anything into it',
      };
  }
}

// The comparison must be between two measurements of the SAME product. Two
// lanes run minutes apart on a clean tree agree by construction; two result
// files picked off disk with --from need not.
function provenanceProblems(metaA, metaB) {
  const problems = [];
  if (!metaA || !metaB) return problems;
  if (metaA.semantic_identity && metaB.semantic_identity &&
      metaA.semantic_identity !== metaB.semantic_identity)
    problems.push(
      `semantic identity differs between the lanes (${String(metaA.semantic_identity).slice(0, 20)}… vs ` +
      `${String(metaB.semantic_identity).slice(0, 20)}…) — this compares two different products, not two lanes`);
  if (metaA.data_source && metaB.data_source && metaA.data_source !== metaB.data_source)
    problems.push(`data source differs between the lanes (${metaA.data_source} vs ${metaB.data_source})`);
  if (metaA.model_id && metaB.model_id && metaA.model_id !== metaB.model_id)
    problems.push(`model differs between the lanes (${metaA.model_id} vs ${metaB.model_id})`);
  return problems;
}

// rows: every result row from both lanes, in any order, from any number of
// files. `declared` maps case name -> declared tier, used only when a row does
// not carry `tier_declared` (files written before EVAL-12a). `problems` carries
// the provenance findings, because they OUTRANK the case-by-case arithmetic:
// two lanes measured against different products can agree perfectly and still
// have compared nothing.
function correlate(rows, { quorum = null, declared = {}, problems = [] } = {}) {
  const byCase = new Map();
  for (const r of rows.filter(isResultRow)) {
    if (!byCase.has(r.case)) byCase.set(r.case, []);
    byCase.get(r.case).push(r);
  }

  const cases = [];
  for (const [name, rs] of [...byCase.entries()].sort()) {
    const declaredTier = rs.find((r) => r.tier_declared != null)?.tier_declared ?? declared[name] ?? 2;
    const t1 = laneVerdict(rs.filter((r) => r.tier === 1), quorum);
    const t2 = laneVerdict(rs.filter((r) => r.tier === 2), quorum);
    const klass = classify(t1, t2);
    cases.push({
      case: name,
      category: rs[0].category || null,
      declared_tier: declaredTier,
      tier1: t1,
      tier2: t2,
      class: klass,
      ...verdictFor(klass, declaredTier),
    });
  }

  const graded = cases.filter((c) => !c.probe);
  const established = graded.filter((c) => ESTABLISHES.has(c.class));
  const disagreements = graded.filter((c) => DISAGREEMENTS.has(c.class));
  const failures = cases.filter((c) => c.gate === 'fail');

  return {
    cases,
    summary: {
      correlated: graded.length,
      established: established.length,
      disagreements: disagreements.length,
      false_green: graded.filter((c) => c.class === CLASS.FALSE_GREEN).map((c) => c.case),
      false_red: graded.filter((c) => c.class === CLASS.FALSE_RED).map((c) => c.case),
      inconclusive: graded.filter((c) => !ESTABLISHES.has(c.class) && !DISAGREEMENTS.has(c.class)).map((c) => c.case),
      probes: cases.filter((c) => c.probe).length,
      promotable: cases.filter((c) => c.probe && c.eligible).map((c) => c.case),
      // The point of the exercise, measured rather than assumed.
      cost: {
        tier1: cases.reduce((a, c) => a + (c.tier1.cost_usd || 0), 0),
        tier2: cases.reduce((a, c) => a + (c.tier2.cost_usd || 0), 0),
      },
      // ESTABLISHED means every tier-1 case was confirmed by its expensive
      // counterpart. It is deliberately not "no failures": a suite where every
      // tier-1 case is red has no failures here either, and has proved nothing.
      // INVALID outranks all of it — an incomparable pair has no verdict to
      // report, and printing ESTABLISHED next to a non-zero exit is the kind of
      // contradictory signal EVAL-8 was about.
      verdict: problems.length ? 'INVALID'
        : failures.length === 0 && graded.length > 0 && established.length === graded.length
          ? 'ESTABLISHED'
          : failures.length ? 'BROKEN' : 'NOT_ESTABLISHED',
    },
  };
}

module.exports = {
  correlate, classify, laneVerdict, verdictFor, reasonKey, sameReasons,
  provenanceProblems, isResultRow, CLASS, ESTABLISHES, DISAGREEMENTS,
};
