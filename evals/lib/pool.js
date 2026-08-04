// =============================================================================
// pool.js — EVAL-12b: run independent agent calls in parallel, carefully.
//
//   Runs are independent samples and the grader shares no state, so fanning out
//   is the boring 4x on wall clock. Two things stop it from being a plain
//   Promise pool.
//
//   1. WARM BEFORE FANNING OUT, IN BOTH DIMENSIONS. Prompt caching (EVAL-12c)
//      is content-keyed, and the tier-1 prompt caches in two blocks: a ~5.7k
//      block shared by every case, and a ~10k block per case (CLAUDE.md, the
//      routing table and the question cache together, so a different question
//      invalidates the whole block). Two rules follow, and the first sweep to
//      run this shipped with only one of them:
//
//        a. Job 0 runs alone, which creates the shared block once for the
//           whole sweep.
//        b. The other runs OF A CASE wait for that case's first run. They are
//           byte-identical prompts, so the leader's write is what makes them
//           free — and starting two of them together makes each pay for the
//           same ~10k block.
//
//      Measured 2026-07-31 with only (a): aov-synonym's runs 2 and 3 read 100%
//      of their prefix, and refusal-routing-decision's runs 1 and 2 — which
//      the fan-out started together — BOTH created 10,191 tokens. 62% of prefix
//      tokens read where a perfectly scheduled sweep gets 71%. Warmed in the
//      run dimension, cold in the case dimension: "closed in one dimension is
//      not closed", again.
//
//      Leaders of DIFFERENT cases still run concurrently. Their per-case blocks
//      genuinely differ, so that creation is not waste and serialising it would
//      buy nothing.
//
//   2. ONE QUERY AT A TIME. `serialize` keeps the DuckDB path byte-identical to
//      a serial sweep. Grading queries take milliseconds against the agent's
//      minutes, so the wall-clock cost is nil and it removes concurrency as a
//      possible explanation for a verdict — which is the whole reason a sweep
//      is worth reading.
// =============================================================================

// Run `worker` over every job, at most `concurrency` at a time. Resolves when
// all of them are done; a worker that throws rejects the pool, which is why
// run.js's worker resolves its own failures into verdicts rather than throwing.
//
// `groupOf(job)` names the cache group a job belongs to (the case). Jobs must be
// ordered group-major — the first job of a group in the list is its leader.
// Omit it and the pool degrades to rule (a) alone.
async function runPool(jobs, concurrency, worker, { groupOf = () => null } = {}) {
  if (concurrency <= 1 || jobs.length <= 1) {
    for (const job of jobs) await worker(job);
    return;
  }

  await worker(jobs[0]);   // rule (a): create the shared block once

  const queue = jobs.slice(1);
  const warm = new Set([groupOf(jobs[0])]);   // groups whose leader has finished
  const claimed = new Set([groupOf(jobs[0])]);// groups whose leader has started
  let inFlight = 0;

  // Woken on every completion, so a worker parked behind a leader re-checks
  // rather than spinning.
  let waiters = [];
  const wake = () => { const w = waiters; waiters = []; w.forEach((r) => r()); };
  const progress = () => new Promise((r) => waiters.push(r));

  // The first eligible job: any leader not yet started, or a follower whose
  // leader has finished. A follower whose leader is still in flight is skipped,
  // not waited on — there may be another group ready to go.
  const nextJob = () => {
    for (let i = 0; i < queue.length; i++) {
      const g = groupOf(queue[i]);
      if (g == null || warm.has(g)) return queue.splice(i, 1)[0];
      if (!claimed.has(g)) { claimed.add(g); return queue.splice(i, 1)[0]; }
    }
    return null;
  };

  const run = async () => {
    for (;;) {
      const job = nextJob();
      if (!job) {
        // Nothing eligible. If nothing is running either, there is nothing
        // coming: every remaining job would have been eligible.
        if (inFlight === 0) return;
        await progress();
        continue;
      }
      inFlight++;
      try {
        await worker(job);
      } finally {
        inFlight--;
        warm.add(groupOf(job));
        wake();
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length - 1) }, run),
  );
}

// Wrap an async function so calls queue instead of overlapping. Rejections are
// passed through to the caller but never break the chain for the next call.
function serialize(fn) {
  let tail = Promise.resolve();
  return (...args) => {
    const result = tail.then(() => fn(...args));
    tail = result.then(() => {}, () => {});
    return result;
  };
}

module.exports = { runPool, serialize };
