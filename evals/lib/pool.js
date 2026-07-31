// =============================================================================
// pool.js — EVAL-12b: run independent agent calls in parallel, carefully.
//
//   Runs are independent samples and the grader shares no state, so fanning out
//   is the boring 4x on wall clock. Two things stop it from being a plain
//   Promise pool.
//
//   1. WARM FIRST, THEN FAN OUT. Prompt caching (EVAL-12c) is content-keyed on
//      the shared prefix: the first call pays ~13k tokens of cache CREATION and
//      every call after it reads the same prefix for ~5x less. Start N workers
//      cold and all N write their own copy of that prefix, which gives most of
//      the 5x straight back. So job 0 runs alone to completion — one cache
//      write for the whole sweep — and the rest fan out behind it. The
//      `Prompt cache:` line in the sweep summary is how you tell whether this
//      is still working.
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
async function runPool(jobs, concurrency, worker) {
  if (concurrency <= 1 || jobs.length <= 1) {
    for (const job of jobs) await worker(job);
    return;
  }

  await worker(jobs[0]);   // the cache-warming run — see (1) above

  let next = 1;
  const workers = Array.from(
    { length: Math.min(concurrency, jobs.length - 1) },
    async () => { while (next < jobs.length) await worker(jobs[next++]); },
  );
  await Promise.all(workers);
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
