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
const okf = require('./okf-lib');
const mal = require('./malloy-lib');
const { checkGold } = require('./evals/lib/goldcheck');
const evalMal = require('./evals/lib/malloy');

const KP_DIR     = process.env.KP_DIR     || 'kp';
const MODELS_DIR = mal.MODELS_DIR;
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

// ---- compile a Malloy model; now ALSO records field names per concept -------
// (v2 only kept which concepts a source touches; v3 keeps (source, field) so
//  the write-back can render real Implementations tables.)
// The connect/load/definedHere plumbing lives in malloy-lib (SIMP-3); what is
// build-specific is everything below it — reading # concept annotations.
async function compileModel(filePath) {
  // (filePath is returned so the coverage probe can reload the right model)
  const { model, definedHere } = await mal.loadModelFile(filePath, { workdir: WORKDIR });
  const modelName = modelTagOf(model) || path.basename(filePath, '.malloy');

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
  // Everything this file can SEE, defined here or imported. Only used to build
  // the source index for the tier-0 gold checks below — recorded here so those
  // checks reuse this compile instead of paying for a second one.
  const exposes = model.explores.map(e => e.name);
  return { model: modelName, sources, exposes, filePath };
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
  const models = [];
  for (const f of mal.listModelFiles(MODELS_DIR)) models.push(await compileModel(f));
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
        else if (!canon[u].governed)
          warnings.push(`[${m.model}] ${srcName} references '${u}' (status '${canon[u].status}', trust '${canon[u].trust_tier}') — not governed, excluded from agent map`);
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
        const q = `run: ${impl.source} -> { aggregate: min_date is min(${impl.field}), max_date is max(${impl.field}) }`;
        const { rows } = await mal.runQueryIn(m.filePath, q, { workdir: WORKDIR, rowLimit: 1 });
        const row = rows[0];
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
  // A GOVERNED concept (status: stable + human-verified) with no implementation
  // is a definition the agent can route to and then cannot answer from — the
  // routing table promises a binding that does not exist. That is an error, not
  // a warning (SIMP-4, tier 0). Drafts and unverified concepts are exempt:
  // unbuilt is the normal state of something not yet governed.
  const unbuilt = Object.entries(canon)
    .filter(([uri, c]) => c.governed && !touch[uri])
    .map(([uri]) => uri);
  if (unbuilt.length) {
    console.error('\nBUILD FAILED — governed concepts with no implementation:');
    unbuilt.forEach(u => console.error(`  ${u} — no model implements it (bind it, or set status: draft / remove verified)`));
    process.exit(1);
  }
  for (const m of models)
    for (const [srcName, s] of Object.entries(m.sources)) {
      const un = (s.ungoverned || []);
      if (un.length)
        warnings.push(`[coverage] built but ungoverned in ${m.model}.${srcName}: ${un.join(', ')} — fields with no # concept annotation`);
    }
  warnings.length && console.warn(warnings.filter(w => w.startsWith('[coverage]')).map(w => '  WARN ' + w).join('\n'));

  // The source index (source name -> defining/exposing model file) is
  // assembled from the compile we already did rather than compiling every
  // model a second time. Shared by the eval-case check and the examples check
  // below, both of which need to know which model file runs a given source.
  const index = { defines: {}, exposes: {} };
  for (const m of models) {
    for (const src of Object.keys(m.sources)) if (!index.defines[src]) index.defines[src] = m.filePath;
    for (const src of (m.exposes || [])) (index.exposes[src] ||= []).push(m.filePath);
  }

  // 5b. tier-0 eval checks (SIMP-4). Every eval case parses, every gold_query
  //     still runs, no committed gold value has drifted. No LLM is involved, so
  //     this is validation like everything above it — and it gates PRs here
  //     instead of in a second workflow that has to be remembered.
  {
    const { lines, problems } = await checkGold({ workdir: WORKDIR, index });
    lines.forEach(l => console.log('  ' + l));
    if (problems.length) {
      console.error('\nBUILD FAILED — eval suite (tier 0):');
      problems.forEach(p => console.error('  ' + p));
      process.exit(1);
    }
    console.log(`Eval cases (tier 0): ${lines.length} checked, gold current`);
  }

  // 5c. kp/agent/examples.md must actually run. CLAUDE.md tells every agent to
  //     copy these shapes verbatim and to compile a new example before adding
  //     it — a snippet that silently stops compiling (a renamed field, a join
  //     alias that moved) teaches every future session the wrong syntax with
  //     nothing to catch it until an agent hits the error live. Same discipline
  //     as the gold queries above: run each ```malloy fence, fail the build if
  //     one doesn't.
  {
    const examplesPath = path.join(KP_DIR, 'agent', 'examples.md');
    if (fs.existsSync(examplesPath)) {
      const text = fs.readFileSync(examplesPath, 'utf8');
      const blocks = [...text.matchAll(/```malloy\n([\s\S]*?)```/g)].map(m => m[1]);
      const exampleProblems = [];
      for (const [i, block] of blocks.entries()) {
        try {
          await evalMal.runQuery(block, { workdir: WORKDIR, index, rowLimit: 1 });
        } catch (e) {
          const firstLine = block.trim().split('\n')[0];
          exampleProblems.push(`block ${i + 1} (${firstLine} ...): ${e.message || e}`);
        }
      }
      if (exampleProblems.length) {
        console.error('\nBUILD FAILED — kp/agent/examples.md has a snippet that does not run:');
        exampleProblems.forEach(p => console.error('  ' + p));
        process.exit(1);
      }
      console.log(`Examples (kp/agent/examples.md): ${blocks.length} snippet(s) compiled and ran`);
    } else {
      console.warn('  WARN kp/agent/examples.md not found — skipping examples check');
    }
  }

  // 6. write everything back into the bundle (the bundle IS the agent context)
  const sourceConcepts = {};
  for (const m of models)
    for (const [srcName, s] of Object.entries(m.sources))
      if (s.concept) sourceConcepts[`${m.model}.${srcName}`] = s.concept;
  const touched = okf.writeBack(KP_DIR, bundle, implementations, sourceConcepts,
                                { views: viewInventory, coverage });

  // 7. refresh the graphs (best effort — needs knowledge-catalog cloned + pyyaml)
  //    `python3` is not a real interpreter on Windows (Store stub), so probe for
  //    one that can actually import yaml rather than assuming a name.
  const { execSync } = require('child_process');
  const python = ['python3', 'python', 'py -3'].find(p => {
    try { execSync(`${p} -c "import yaml"`, { stdio: 'pipe' }); return true; } catch { return false; }
  });
  if (!python)
    console.log('(viz skipped — no python on PATH with pyyaml; run: pip install pyyaml)');
  else
    for (const [out, flag] of [['kp_viz.html', ''], ['kp_viz_conceptual.html', '--conceptual']]) {
      try {
        execSync(`${python} make_viz.py ${KP_DIR} ${out} ${flag}`, { stdio: 'pipe' });
        console.log(`Graph refreshed -> ${out}`);
      } catch (e) {
        // surface the real cause instead of always blaming the missing clone
        const why = String(e.stderr || e.message).trim().split('\n').pop();
        console.log(`(viz skipped for ${out} — ${why})`);
      }
    }

  const shared = Object.keys(touch).filter(u => touch[u].size > 1);
  console.log('\nConcepts used: ' + Object.keys(touch).length + ' / ' + Object.keys(canon).length + ' canonical');
  console.log('Shared concepts (>1 model): ' + shared.length + (shared.length ? ' -> ' + shared.join(', ') : ''));
  console.log('Write-back: ' + touched + ' concept files updated, routing table + indexes regenerated');
})().catch(e => { console.error('FATAL:', e.stack || e); process.exit(1); });
