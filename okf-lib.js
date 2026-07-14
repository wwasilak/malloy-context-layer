// =============================================================================
// okf-lib.js — Knowledge Plane as an OKF bundle (markdown + YAML frontmatter).
// Replaces the MOTLY parser. Three responsibilities:
//   loadBundle(dir)   -> { namespace, canon, rels }   (registry, same shape as before)
//   emitMap(...)      -> knowledge_map.json object    (agent routing map)
//   writeBack(...)    -> regenerate index.md files + "## Implementations"
//                        sections between GENERATED markers in concept files.
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
  let namespace = null;
  const cfgPath = path.join(dir, 'bundle.yaml');
  if (fs.existsSync(cfgPath)) {
    const cfg = matter('---\n' + fs.readFileSync(cfgPath, 'utf8') + '\n---\n').data;
    namespace = cfg.namespace || null;
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

    if (!d.uri)  { errors.push(`[KP] ${rel}: missing required field 'uri'`); continue; }
    if (!d.type) { errors.push(`[KP] ${rel}: missing required field 'type'`); continue; }
    if (!KINDS.has(d.type)) errors.push(`[KP] ${rel}: unknown type '${d.type}'`);
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
      membership_rule: d.membership_rule || null,
      preferred_source: d.preferred_source || null,
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
  return { namespace, canon, rels, errors };
}

// ---- 2. emit the agent map (same shape as the MOTLY-era output) --------------
function emitMap({ namespace, canon, rels }, touch, usedRels, implementations) {
  const order = ['entity', 'defined_class', 'measure', 'attribute'];
  const uris = Object.keys(canon)
    .filter((u) => touch[u] && canon[u].status === 'approved')
    .sort((a, b) =>
      (order.indexOf(canon[a].kind) - order.indexOf(canon[b].kind)) || a.localeCompare(b));

  return {
    _doc: 'Knowledge Plane — agent context. Meaning + routing only; fields live in the Malloy models (compile the named source). If a term is not a concept here, it is NOT modelled — say so; do not improvise it from raw columns.',
    namespace,
    concepts: uris.map((u) => {
      const c = canon[u];
      const o = { uri: u, kind: c.kind, label: c.label, definition: c.definition,
                  models: [...touch[u]].sort() };
      if (c.synonyms.length) o.synonyms = c.synonyms;
      if (c.steward) o.steward = c.steward;
      if (c.subtype_of) o.subtype_of = c.subtype_of;
      if (c.membership_rule) o.membership_rule = c.membership_rule;
      if (c.preferred_source) o.preferred_source = c.preferred_source;
      return o;
    }),
    relationships: [...usedRels].sort().map((u) => {
      const r = rels[u];
      return { uri: u, verb: r.label, domain: r.domain, range: r.range };
    }),
  };
}

// ---- 3. write back: Implementations sections + index.md files ----------------
// implementations: uri -> [{model, source, field|null (null = the source itself)}]
function writeBack(dir, { canon }, implementations) {
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
  const rootLines = [
    '<!-- GENERATED by exporter — do not edit. -->',
    '# Knowledge Plane — domains', '',
    ...Object.keys(byDomain).sort().map((d) => {
      const n = byDomain[d].length;
      const stewards = [...new Set(byDomain[d].map((u) => canon[u].steward).filter(Boolean))];
      return `- [**${d}**](./${d}/index.md) — ${n} concepts${stewards.length ? ` (steward: ${stewards.join(', ')})` : ''}`;
    }), '',
    'Start at a domain index, then open the concept file. Concept files carry meaning;',
    'their `## Implementations` sections and all `index.md` files are build-generated.', '',
  ];
  fs.writeFileSync(path.join(dir, 'index.md'), rootLines.join('\n'));
  return touched;
}

module.exports = { loadBundle, emitMap, writeBack, GEN_BEGIN, GEN_END };
