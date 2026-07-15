#!/usr/bin/env node
// =============================================================================
// build.js — the ONE build command: validate Knowledge Plane (OKF) against the
//            compiled Malloy models, then project the links back into the bundle.
//
//   The KP is now a directory of markdown files with YAML frontmatter (OKF).
//   Malloy models are UNCHANGED: they still link via `# concept = "kp:..."`.
//   Models are COMPILED (not regex-scanned); annotations via parseAsTag().
//
//   HARD-FAILS if a model references a URI with no concept file, or if a KP
//   preferred_source doesn't resolve to a real (model, source).
//
//   Write-back (option 3 / hybrid linking): after validation, the exporter
//   regenerates every index.md and each concept's "## Implementations" section,
//   so the KP shows the full mapping without anyone hand-maintaining it.
// =============================================================================
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const malloy = require('@malloydata/malloy');
const { DuckDBConnection } = require('@malloydata/db-duckdb');
const okf = require('./okf-lib');

const KP_DIR     = process.env.KP_DIR     || 'kp';
const MODELS_DIR = process.env.MODELS_DIR || 'models';
const WORKDIR    = process.env.WORKDIR    || process.cwd();

// ---- helpers: pull tag values via the Annotations view (unchanged from v2) --
function tagValue(entity, prop) {
  if (!entity || !entity.annotations || typeof entity.annotations.parseAsTag !== 'function') return null;
  const tag = entity.annotations.parseAsTag().tag;
  const p = tag && tag.properties && tag.properties[prop];
  return p && p.eq ? p.eq : null;
}
const conceptOf = e => tagValue(e, 'concept');
const roleOf    = e => tagValue(e, 'is_about_role');

function modelTagOf(model) {
  if (!model || typeof model.tagParse !== 'function') return null;
  const t = model.tagParse().tag;
  const p = t && t.properties && t.properties.model;
  return p && p.eq ? p.eq : null;
}

const urlReader = { readURL: async (url) => fs.readFileSync(url, 'utf8') };

// ---- compile a Malloy model; now ALSO records field names per concept -------
// (v2 only kept which concepts a source touches; v3 keeps (source, field) so
//  the write-back can render real Implementations tables.)
async function compileModel(filePath) {
  // (filePath is returned so the coverage probe can reload the right model)
  const conn = new DuckDBConnection('duckdb', undefined, WORKDIR);
  const runtime = new malloy.SingleConnectionRuntime({ connection: conn, urlReader });
  const selfUrl = pathToFileURL(path.resolve(filePath)).href;
  const model = await runtime.loadModel(new URL(selfUrl)).getModel();
  const modelName = modelTagOf(model) || path.basename(filePath, '.malloy');

  const selfFile = path.basename(filePath);
  const definedHere = loc =>
    !!loc && !!loc.url && (loc.url === selfUrl || loc.url.endsWith('/' + selfFile));

  const sources = {};
  for (const exp of model.explores) {
    if (!definedHere(exp.location)) continue;
    const fieldConcepts = [];   // [{concept, field}]
    const joinRoles = [];
    const views = [];           // pre-built query surfaces (turtles/views)
    const ungoverned = [];      // fields with no # concept annotation
    for (const f of exp.allFields) {
      if (!definedHere(f.location)) continue;
      const ctor = f.constructor ? f.constructor.name : '';
      const isJoin = /Explore/.test(ctor);
      const isView = /Query|Turtle/.test(ctor) || (typeof f.isQueryField === 'function' && f.isQueryField());
      const fc = conceptOf(f);
      const role = roleOf(f);
      if (isJoin && role) joinRoles.push(role);
      if (isView) views.push({ name: f.name, description: tagValue(f, 'description') });
      if (fc) fieldConcepts.push({ concept: fc, field: f.name });
      else if (!isJoin && !isView) ungoverned.push(f.name);
    }
    sources[exp.name] = { concept: conceptOf(exp), fieldConcepts, joinRoles, views, ungoverned };
  }
  return { model: modelName, sources, filePath };
}

// ---- main --------------------------------------------------------------------
(async () => {
  // 1. load + validate the OKF bundle itself
  const bundle = okf.loadBundle(KP_DIR);
  if (bundle.errors.length) {
    console.error('\nBUILD FAILED — Knowledge Plane bundle validation:');
    bundle.errors.forEach(e => console.error('  ' + e));
    process.exit(1);
  }
  const { canon, rels } = bundle;
  console.log('Knowledge Plane (OKF): ' + Object.keys(canon).length + ' concepts, '
              + Object.keys(rels).length + ' relationships');

  // 2. compile all models
  const modelFiles = fs.readdirSync(MODELS_DIR).filter(f => f.endsWith('.malloy'));
  const models = [];
  for (const f of modelFiles) models.push(await compileModel(path.join(MODELS_DIR, f)));
  console.log('Models compiled: ' + models.map(m => m.model).join(', '));

  // 3. cross-plane referential validation (same discipline as v2)
  const errors = [], warnings = [];
  for (const m of models) {
    for (const [srcName, s] of Object.entries(m.sources)) {
      const used = new Set();
      if (s.concept) used.add(s.concept);
      for (const fc of s.fieldConcepts) used.add(fc.concept);
      for (const u of used) {
        if (!canon[u]) errors.push(`[${m.model}] concept not in KP: ${u} (source ${srcName})`);
        else if (canon[u].status !== 'approved')
          warnings.push(`[${m.model}] ${srcName} references '${u}' with status '${canon[u].status}' — excluded from agent map`);
      }
      for (const r of s.joinRoles)
        if (!rels[r]) errors.push(`[${m.model}] relationship not in KP: ${r} (source ${srcName})`);
    }
  }
  for (const [uri, c] of Object.entries(canon)) {
    if (!c.preferred_source) continue;
    const [mdl, src] = c.preferred_source.split('.');
    if (!models.find(m => m.model === mdl && m.sources[src]))
      errors.push(`[KP] preferred_source for ${uri} not found: ${c.preferred_source}`);
  }
  if (errors.length) {
    console.error('\nBUILD FAILED — referential validation:');
    errors.forEach(e => console.error('  ' + e));
    process.exit(1);
  }
  // declared `of` vs implemented host source — the cheap drift sensor
  {
    const srcConcept = {};
    for (const m of models)
      for (const [srcName, s] of Object.entries(m.sources))
        if (s.concept) srcConcept[`${m.model}.${srcName}`] = s.concept;
    for (const m of models)
      for (const [srcName, s] of Object.entries(m.sources))
        for (const fc of s.fieldConcepts) {
          const declared = canon[fc.concept] && canon[fc.concept].of;
          const host = srcConcept[`${m.model}.${srcName}`];
          if (declared && host && declared !== host)
            warnings.push(`[drift] ${fc.concept} declared of=${declared} but implemented on ${m.model}.${srcName} (${host})`);
        }
  }
  warnings.forEach(w => console.warn('  WARN ' + w));
  console.log('Referential validation: OK');

  // 4. usage + implementations
  const touch = {}, usedRels = new Set(), implementations = {};
  for (const m of models) {
    for (const [srcName, s] of Object.entries(m.sources)) {
      if (s.concept) {
        (touch[s.concept] ||= new Set()).add(m.model);
        (implementations[s.concept] ||= []).push({ model: m.model, source: srcName, field: null });
      }
      for (const fc of s.fieldConcepts) {
        (touch[fc.concept] ||= new Set()).add(m.model);
        (implementations[fc.concept] ||= []).push({ model: m.model, source: srcName, field: fc.field });
      }
      for (const r of s.joinRoles) usedRels.add(r);
    }
  }

  // 4b. views inventory — the sanctioned pre-built query surfaces
  const viewInventory = [];
  for (const m of models)
    for (const [srcName, s] of Object.entries(m.sources))
      for (const v of (s.views || []))
        viewInventory.push({ path: `${m.model}.${srcName}.${v.name}`,
                             ...(v.description ? { description: v.description } : {}) });

  // 4c. data coverage — min/max of the temporal anchor concept (bundle.yaml:
  // temporal_anchor: kp:OrderDate). Non-fatal: on any failure, warn and omit.
  let coverage = null;
  const anchor = bundle.config && bundle.config.temporal_anchor;
  if (anchor) {
    const impl = (implementations[anchor] || []).find(i => i.field);
    if (!impl) {
      console.warn(`  WARN temporal_anchor ${anchor} has no field binding — data_coverage omitted`);
    } else {
      try {
        const m = models.find(x => x.model === impl.model);
        const conn = new DuckDBConnection('duckdb', undefined, WORKDIR);
        const runtime = new malloy.SingleConnectionRuntime({ connection: conn, urlReader });
        const mm = runtime.loadModel(new URL(pathToFileURL(path.resolve(m.filePath)).href));
        const q = `run: ${impl.source} -> { aggregate: min_date is min(${impl.field}), max_date is max(${impl.field}) }`;
        const res = await mm.loadQuery(q).run({ rowLimit: 1 });
        const row = res.data.toObject()[0];
        const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
        coverage = { anchor_concept: anchor, binding: `${impl.model}.${impl.source}.${impl.field}`,
                     min_date: iso(row.min_date), max_date: iso(row.max_date),
                     note: 'Anchor relative time windows (e.g. \'last 2 years\') to max_date, not today, and say so in the answer.' };
        console.log(`Data coverage (${anchor}): ${coverage.min_date} .. ${coverage.max_date}`);
      } catch (e) {
        console.warn('  WARN data_coverage probe failed: ' + (e.message || e));
      }
    }
  }

  // 5. coverage checks
  for (const [uri, c] of Object.entries(canon)) {
    if (c.status === 'approved' && !touch[uri])
      warnings.push(`[coverage] approved but unbuilt: ${uri} — no model implements it`);
  }
  for (const m of models)
    for (const [srcName, s] of Object.entries(m.sources)) {
      const un = (s.ungoverned || []);
      if (un.length)
        warnings.push(`[coverage] built but ungoverned in ${m.model}.${srcName}: ${un.join(', ')} — fields with no # concept annotation`);
    }
  warnings.length && console.warn(warnings.filter(w => w.startsWith('[coverage]')).map(w => '  WARN ' + w).join('\n'));

  // 6. write everything back into the bundle (the bundle IS the agent context)
  const sourceConcepts = {};
  for (const m of models)
    for (const [srcName, s] of Object.entries(m.sources))
      if (s.concept) sourceConcepts[`${m.model}.${srcName}`] = s.concept;
  const touched = okf.writeBack(KP_DIR, bundle, implementations, sourceConcepts,
                                { views: viewInventory, coverage });

  // 7. refresh the graph (best effort — needs knowledge-catalog cloned + python3)
  try {
    require('child_process').execSync(`python3 make_viz.py ${KP_DIR} kp_viz.html`, { stdio: 'pipe' });
    console.log('Graph refreshed -> kp_viz.html');
  } catch (e) { console.log('(viz skipped — clone GoogleCloudPlatform/knowledge-catalog to enable)'); }

  const shared = Object.keys(touch).filter(u => touch[u].size > 1);
  console.log('\nConcepts used: ' + Object.keys(touch).length + ' / ' + Object.keys(canon).length + ' canonical');
  console.log('Shared concepts (>1 model): ' + shared.length + (shared.length ? ' -> ' + shared.join(', ') : ''));
  console.log('Write-back: ' + touched + ' concept files updated, routing table + indexes regenerated');
})().catch(e => { console.error('FATAL:', e.stack || e); process.exit(1); });
