// =============================================================================
// malloy-lib.js — the ONE place that turns .malloy files into a compiled model.
//
//   build.js and the eval harness both need the same four steps: open a DuckDB
//   connection rooted at a workdir, load a model file, work out which entities
//   that file DEFINES (as opposed to merely imports), and run a query in a
//   model's context. Both had grown their own copy — same sequence, same
//   `definedHere` predicate, independent drift risk (SIMP-3). This is that
//   sequence, once.
//
//   What stays OUT of here: anything either caller means by the result.
//   build.js owns concept annotations and referential validation; the harness
//   owns canonicalisation and result comparison. This file only knows how to
//   get a model and get rows back.
//
//   `workdir` is always an explicit argument. The two callers disagree about
//   where data lives on purpose — build.js honours WORKDIR, the harness picks
//   between committed fixtures and EVAL_LIVE_WORKDIR (EVAL-4) — and that
//   decision is theirs, not this file's.
// =============================================================================
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const malloy = require('@malloydata/malloy');
const { DuckDBConnection } = require('@malloydata/db-duckdb');

const MODELS_DIR = process.env.MODELS_DIR || 'models';

const urlReader = { readURL: async (url) => fs.readFileSync(url, 'utf8') };

function newRuntime(workdir) {
  const connection = new DuckDBConnection('duckdb', undefined, workdir);
  return new malloy.SingleConnectionRuntime({ connection, urlReader });
}

// Sorted so the compile order — and therefore every "first model that exposes
// X" tie-break below — is the same on every platform.
function listModelFiles(dir = MODELS_DIR) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.malloy')).sort()
    .map((f) => path.join(dir, f));
}

// A source defined in base.malloy is visible from every model that imports it,
// so `model.explores` alone cannot tell you where something came from. Compare
// the entity's location against the file being compiled.
const definedIn = (loc, selfUrl, selfFile) =>
  !!loc && !!loc.url && (loc.url === selfUrl || loc.url.endsWith('/' + selfFile));

// Compile one model file. Returns the model plus a `definedHere` predicate
// already closed over this file's identity, which is what both callers use to
// filter `explores` / `allFields`.
async function loadModelFile(filePath, { workdir, runtime } = {}) {
  const rt = runtime || newRuntime(workdir);
  const selfUrl = pathToFileURL(path.resolve(filePath)).href;
  const selfFile = path.basename(filePath);
  const model = await rt.loadModel(new URL(selfUrl)).getModel();
  return {
    model,
    filePath,
    selfUrl,
    selfFile,
    definedHere: (loc) => definedIn(loc, selfUrl, selfFile),
  };
}

// ---- source -> model index --------------------------------------------------
// Which model file defines each source, and which can see it. Prefer the
// definer: deterministic, and it keeps a query in the narrowest context that
// can serve it.
async function buildSourceIndex(workdir, { modelsDir = MODELS_DIR } = {}) {
  const runtime = newRuntime(workdir);
  const defines = {};   // source -> model file that defines it
  const exposes = {};   // source -> [model files that can see it]
  const problems = [];

  for (const filePath of listModelFiles(modelsDir)) {
    let loaded;
    try {
      loaded = await loadModelFile(filePath, { runtime });
    } catch (e) {
      problems.push(`${filePath}: ${e.message || e}`);
      continue;
    }
    for (const exp of loaded.model.explores) {
      (exposes[exp.name] ||= []).push(filePath);
      if (loaded.definedHere(exp.location) && !defines[exp.name]) defines[exp.name] = filePath;
    }
  }
  if (problems.length) throw new Error('model compilation failed:\n  ' + problems.join('\n  '));
  return { defines, exposes };
}

// ---- run --------------------------------------------------------------------
// Execute query text in the context of one model file. Caller decides which
// file that is (by source index, or directly).
async function runQueryIn(modelFile, queryText, { workdir, runtime, rowLimit = 200 } = {}) {
  const rt = runtime || newRuntime(workdir);
  const mm = rt.loadModel(new URL(pathToFileURL(path.resolve(modelFile)).href));
  const result = await mm.loadQuery(queryText).run({ rowLimit });
  return { rows: result.data.toObject(), modelFile };
}

module.exports = {
  MODELS_DIR, urlReader, newRuntime, listModelFiles,
  definedIn, loadModelFile, buildSourceIndex, runQueryIn,
};
