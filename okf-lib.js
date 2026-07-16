// =============================================================================
// okf-lib.js — Knowledge Plane as an OKF bundle (markdown + YAML frontmatter).
// Replaces the MOTLY parser. Three responsibilities:
//   loadBundle(dir)   -> { namespace, config, canon, rels } registry. Files whose
//                        type is not a concept kind are operational docs (skipped).
//   writeBack(...)    -> regenerate the root routing table (index.md), domain
//                        indexes, and the GENERATED "## Implementations" sections.
// Humans own meaning (frontmatter + prose). The build owns bookkeeping.
// =============================================================================
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const GEN_BEGIN = '<!-- BEGIN GENERATED: implementations (written by exporter; do not edit) -->';
const GEN_END = '<!-- END GENERATED -->';
const RESERVED = new Set(['index.md', 'readme.md', 'log.md']);
const KINDS = new Set(['entity', 'defined_class', 'measure', 'attribute']);

// ---- 1. load ----------------------------------------------------------------
function loadBundle(dir) {
  const errors = [];
  const canon = {};   // uri -> concept (incl. _path, _body, status)
  const rels = {};    // uri -> { label(verb), domain, range }

  // bundle-level config
  let namespace = null, config = {};
  const cfgPath = path.join(dir, 'bundle.yaml');
  if (fs.existsSync(cfgPath)) {
    config = matter('---\n' + fs.readFileSync(cfgPath, 'utf8') + '\n---\n').data || {};
    namespace = config.namespace || null;
  }
  if (!namespace) errors.push(`[KP] missing or empty ${cfgPath} (needs: namespace)`);

  // walk domain folders (skip _templates and reserved files)
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith('_') || e.name.startsWith('.')) return [];
    const p = path.join(d, e.name);
    if (e.isDirectory()) return walk(p);
    if (!e.name.endsWith('.md') || RESERVED.has(e.name.toLowerCase())) return [];
    return [p];
  });

  for (const file of walk(dir)) {
    const rel = path.relative(dir, file);
    let fm;
    try { fm = matter(fs.readFileSync(file, 'utf8')); }
    catch (e) { errors.push(`[KP] ${rel}: broken YAML frontmatter — ${e.message}`); continue; }
    const d = fm.data;

    if (!d.type) { errors.push(`[KP] ${rel}: missing required field 'type'`); continue; }
    if (!KINDS.has(d.type)) continue; // operational doc (evals, gap-log, ...) — not a concept
    if (!d.uri)  { errors.push(`[KP] ${rel}: missing required field 'uri'`); continue; }
    if (!d.title) errors.push(`[KP] ${rel}: missing 'title'`);
    if (!d.description) errors.push(`[KP] ${rel}: missing 'description'`);
    if (d.type === 'defined_class' && !d.membership_rule)
      errors.push(`[KP] ${rel}: defined_class requires 'membership_rule'`);
    if (canon[d.uri]) errors.push(`[KP] duplicate uri ${d.uri} in ${rel} and ${canon[d.uri]._path}`);

    canon[d.uri] = {
      kind: d.type,
      label: d.title || null,
      definition: d.description || null,
      synonyms: Array.isArray(d.synonyms) ? d.synonyms : [],
      steward: d.steward || null,
      subtype_of: d.subtype_of || null,
      of: d.of || null,
      membership_rule: d.membership_rule || null,
      preferred_source: d.preferred_source || null,
      allowed_roles: Array.isArray(d.allowed_roles) ? d.allowed_roles : null,
      last_validated: d.last_validated || null,
      status: d.status || 'draft',
      _path: rel,
      _domain: rel.split(path.sep)[0],
    };

    for (const r of d.relationships || []) {
      if (!r.uri || !r.verb || !r.range) {
        errors.push(`[KP] ${rel}: relationship needs uri, verb, range`); continue;
      }
      if (rels[r.uri]) errors.push(`[KP] duplicate relationship ${r.uri} (in ${rel})`);
      rels[r.uri] = { label: r.verb, domain: d.uri, range: r.range };
    }
  }

  // internal referential integrity
  for (const [uri, c] of Object.entries(canon)) {
    if (c.subtype_of && !canon[c.subtype_of])
      errors.push(`[KP] ${c._path}: subtype_of '${c.subtype_of}' has no concept file`);
  }
  for (const [ruri, r] of Object.entries(rels)) {
    if (!canon[r.range]) errors.push(`[KP] relationship ${ruri}: range '${r.range}' has no concept file`);
  }
  return { namespace, config, canon, rels, errors };
}

// ---- 3. write back: Implementations sections + index.md files ----------------
// implementations: uri -> [{model, source, field|null (null = the source itself)}]
function writeBack(dir, { canon }, implementations, sourceConcepts = {}, extras = {}) {
  const { views = [], coverage = null } = extras;
  // sourceConcepts: "model.source" -> concept URI of that source (from compile)
  const relLink = (fromPath, toPath) => {
    const rel = path.relative(path.dirname(fromPath), toPath).split(path.sep).join('/');
    return rel;
  };
  let touched = 0;
  for (const [uri, c] of Object.entries(canon)) {
    const file = path.join(dir, c._path);
    const text = fs.readFileSync(file, 'utf8');
    const b = text.indexOf(GEN_BEGIN), e = text.indexOf(GEN_END);
    if (b === -1 || e === -1 || e < b) continue; // no markers: nothing to do

    const impls = implementations[uri] || [];
    let section;
    if (!impls.length) {
      section = '_Defined in the Knowledge Plane but not yet linked from any Malloy model._';
    } else {
      const rows = impls
        .sort((x, y) => (x.model + x.source + (x.field || '')).localeCompare(y.model + y.source + (y.field || '')))
        .map((i) => `| ${i.model} | \`${i.source}\` | ${i.field ? '`' + i.field + '`' : '*(source)*'} |`);
      section = ['| Model | Source | Field |', '|---|---|---|', ...rows].join('\n');
      if (c.preferred_source) section += `\n\n**Preferred source:** \`${c.preferred_source}\``;
      // link measures/attributes to the entity of their host source (graph edge)
      if ((c.kind === 'measure' || c.kind === 'attribute') && !c.of) {
        const hosts = [...new Set(impls.map(i => sourceConcepts[`${i.model}.${i.source}`]).filter(h => h && h !== uri && canon[h]))];
        if (hosts.length)
          section += '\n\nMeasured on ' + hosts.map(h => `[${canon[h].label}](${relLink(c._path, canon[h]._path)})`).join(', ') + '.';
      }
    }
    const next = text.slice(0, b + GEN_BEGIN.length) + '\n' + section + '\n' + text.slice(e);
    if (next !== text) { fs.writeFileSync(file, next); touched++; }
  }

  // ---- regenerate index.md files (root + one per domain) --------------------
  const byDomain = {};
  for (const [uri, c] of Object.entries(canon)) (byDomain[c._domain] ||= []).push(uri);

  const kindOrder = ['entity', 'defined_class', 'measure', 'attribute'];
  for (const [domain, uris] of Object.entries(byDomain)) {
    uris.sort((a, b) =>
      (kindOrder.indexOf(canon[a].kind) - kindOrder.indexOf(canon[b].kind)) || a.localeCompare(b));
    const lines = [
      '<!-- GENERATED by exporter — do not edit. -->',
      `# ${domain}`, '',
      '| Concept | Kind | Status | Definition |', '|---|---|---|---|',
      ...uris.map((u) => {
        const c = canon[u];
        const fname = path.basename(c._path);
        return `| [${c.label}](./${fname}) \`${u}\` | ${c.kind} | ${c.status} | ${c.definition} |`;
      }), '',
    ];
    fs.writeFileSync(path.join(dir, domain, 'index.md'), lines.join('\n'));
  }
  // root index = the agent's routing table (replaces knowledge_map.json)
  const bindingOf = (uri) => {
    const impls = implementations[uri] || [];
    const pref = canon[uri].preferred_source;
    const sorted = impls
      .map((i) => ({ v: `${i.model}.${i.source}` + (i.field ? `.${i.field}` : ''), p: pref === `${i.model}.${i.source}` }))
      .sort((a, b) => (b.p - a.p) || a.v.localeCompare(b.v));
    return sorted.length ? sorted[0].v : '';
  };
  const kindOrder2 = ['entity', 'defined_class', 'measure', 'attribute'];
  const allUris = Object.keys(canon).sort((a, b) =>
    (kindOrder2.indexOf(canon[a].kind) - kindOrder2.indexOf(canon[b].kind)) || a.localeCompare(b));
  const rootLines = [
    '<!-- GENERATED by build — do not edit. -->',
    '# Knowledge Plane', '',
    'Read this table whole for routing; open a concept file for full meaning',
    '(synonyms, membership rules, relationships, implementations). Only',
    '`approved` concepts are governed. If a term is not here, it is NOT modelled.', '',
  ];
  if (coverage) rootLines.push(
    `**Data coverage** (${coverage.anchor_concept}): ${coverage.min_date} .. ${coverage.max_date} — ` +
    'anchor relative time windows to max_date, not today, and say so.', '');
  if (views.length) {
    rootLines.push('**Views (sanctioned query surfaces):** ' +
      views.map(v => '`' + v.path + '`' + (v.description ? ` (${v.description})` : '')).join(', '), '');
  }
  rootLines.push('| Concept | Kind | Status | Definition | Binding |', '|---|---|---|---|---|');
  for (const u of allUris) {
    const c = canon[u];
    const b = bindingOf(u);
    rootLines.push(`| [${c.label}](./${c._path.split(path.sep).join('/')}) \`${u}\` | ${c.kind} | ${c.status} | ${c.definition} | ${b ? '\`' + b + '\`' : '—'} |`);
  }
  rootLines.push('', 'Domains: ' + Object.keys(byDomain).sort().map(d => `[${d}](./${d}/index.md)`).join(' · '));
  if (fs.existsSync(path.join(dir, 'agent')))
    rootLines.push('', 'Operational: [examples](./agent/examples.md) · [gap log](./agent/gap-log.md) · [question log](./agent/question-log.md) · [corrections](./agent/corrections.md) · [evals](./agent/evals/)');
  rootLines.push('');
  fs.writeFileSync(path.join(dir, 'index.md'), rootLines.join('\n'));
  return touched;
}

module.exports = { loadBundle, writeBack, GEN_BEGIN, GEN_END };
