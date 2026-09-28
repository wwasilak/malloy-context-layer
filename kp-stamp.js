// =============================================================================
// kp-stamp.js — INT-1: stamp the Knowledge Plane into the Malloy models, in place.
//
//   Malloyyo reads annotations, not files: `#"` becomes a description,
//   `#(agent)` becomes instructions (model, source, field). So the KP reaches
//   an MCP-only client by being written INTO the models, next to the
//   `#(kp) concept` link it came from.
//
//   Say each thing ONCE, at the highest level where it is true:
//     model  `##(agent)` — the global rules. Only in index.malloy: `##` does not
//                          survive `import`, and index.malloy is what publishes.
//     source `#"` + `#(agent)` — the entity's definition, domain, steward. Only
//                          on ROOT sources: `extend` inherits source annotations,
//                          so a source extending one with the same concept
//                          already carries them.
//     field  `#"` — the definition. `#(agent)` only when there is something
//                          field-specific (draft, membership rule, roles).
//            A MEASURE with no #(kp) link gets `#(agent) Not governed`. Located
//                          from the compiled model; dimensions are not stamped.
//
//   Ownership is by position, not by marker: on anything carrying a
//   `#(kp) concept` link (and on index.malloy's model annotations), every `#"`
//   and `#(agent)` line is generated. Stamping strips them and regenerates, so
//   the output depends only on the KP — idempotent, and a hand edit is either
//   overwritten (build) or reported (build --check).
//
//   Pure text in -> text out: no Malloy, no filesystem. build.js does the I/O.
// =============================================================================

// Emitted prefixes. `#(doc)` is Publisher's route, emitted only on request.
const OWNED = /^[ \t]*#(?:"|\(agent\)|\(doc\))(?:[ \t]|$)/;
const OWNED_MODEL = /^##(?:"|\(agent\)|\(doc\))(?:[ \t]|$)/;
const CONCEPT = /^([ \t]*)#\(kp\)[ \t]+concept[ \t]*=[ \t]*"([^"]+)"/;
const ANNOTATION = /^[ \t]*#(?!#)/;
const SOURCE_HEAD = /^\s*source:\s*(\w+)\s*(?:\([^)]*\))?\s*is\s+(\w+)/;

const oneLine = s => String(s || '').replace(/\s+/g, ' ').trim();
const sentence = s => oneLine(s).replace(/\.$/, '');

// Model layer: rides every list_sources call — keep it to ~3 sentences.
function modelRules(maxDate) {
  return [
    'A measure is governed unless its instructions say Not governed or Draft: use governed measures as-is, never recompute one from raw columns, and reach a different grain through joins.',
    'Not-governed and Draft measures, and any quantity with no governed measure, are exploratory only: say so.',
    `Anchor relative time windows to the data's max_date${maxDate ? ` (${maxDate})` : ''}, not today.`,
  ].join(' ');
}

// Field layer. Returns { description, instructions|null }.
function fieldProjection(uri, c) {
  const notes = [];
  if (!c.governed) notes.push(`Draft (${uri}, status ${c.status}): exploratory only; label any figure from it ungoverned.`);
  if (c.membership_rule) notes.push(`Membership: ${sentence(c.membership_rule)}. Use this field; never hand-write the filter.`);
  if (c.allowed_roles && c.allowed_roles.length)
    notes.push(`Restricted to roles ${c.allowed_roles.join(', ')}: if the requester's role is unknown or not listed, do not return its figures.`);
  return { description: sentence(c.definition), instructions: notes.length ? notes.join(' ') : null };
}

// Source layer: facts about the entity concept, true wherever inherited.
function sourceProjection(uri, c) {
  const domain = c._domain === 'global' ? 'global' : `${c._domain} domain, steward ${c.steward || 'unassigned'}`;
  const notes = [`${c.label || uri} (${uri}; ${domain}).`];
  if (!c.governed) notes.push(`Draft (status ${c.status}): exploratory only.`);
  if (c.preferred_source) notes.push(`Preferred source for ${uri}: ${c.preferred_source}.`);
  return { description: sentence(c.definition), instructions: notes.join(' ') };
}

// Per-runtime emitters. prefix is '#' (source/field) or '##' (model).
const EMITTERS = {
  malloyyo: (p, prefix) => [
    ...(p.description ? [`${prefix}" ${p.description}`] : []),
    ...(p.instructions ? [`${prefix}(agent) ${p.instructions}`] : []),
  ],
  publisher: (p, prefix) => [`${prefix}(doc) ${oneLine([p.description, p.instructions].filter(Boolean).join('. '))}`],
};
const DEFAULT_TARGETS = ['malloyyo'];
// A measure with no #(kp) link. The model rule reads "governed unless a note
// says otherwise", so silence must mean governed — this is that note.
const UNLINKED_MEASURE = { instructions: 'Not governed: exploratory only.' };

function emit(p, prefix, indent, targets) {
  return targets.flatMap(t => EMITTERS[t](p, prefix)).map(l => indent + l);
}

// Index of the annotation block around line i, and the declaration it attaches to.
function blockAround(lines, i) {
  let start = i, end = i;
  while (start > 0 && ANNOTATION.test(lines[start - 1])) start--;
  while (end + 1 < lines.length && ANNOTATION.test(lines[end + 1])) end++;
  return { start, end, decl: end + 1 < lines.length ? lines.slice(end + 1, end + 3).join(' ') : '' };
}

// Every `source: name ... is base` in these texts -> { name: { base, concept } }.
// Read across ALL model files so a child can see a parent defined elsewhere.
function sourceGraph(texts) {
  const graph = {};
  for (const text of texts) {
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!/^\s*source:/.test(line)) return;
      const m = SOURCE_HEAD.exec(lines.slice(i, i + 2).join(' '));
      if (!m) return;
      let concept = null;
      for (let j = i - 1; j >= 0 && ANNOTATION.test(lines[j]); j--) {
        const c = CONCEPT.exec(lines[j]);
        if (c) concept = c[2];
      }
      graph[m[1]] = { base: m[2], concept };
    });
  }
  return graph;
}

// stampText(text, opts) -> stamped text
//   canon    uri -> concept (okf.loadBundle().canon)
//   graph    sourceGraph() over every model file
//   isIndex  true for index.malloy — the only file that gets the model layer
//   maxDate  data coverage max date, for the model layer
//   targets  subset of Object.keys(EMITTERS); default malloyyo only
//   unlinkedMeasureLines  0-based line numbers (in `text`) of measure
//            declarations with no #(kp) link — from the compiled model, not
//            parsed here. Only their #(agent)/#(doc) lines are owned; a
//            hand-written #" on an unlinked measure is left alone.
function stampText(text, { canon, graph = {}, isIndex = false, maxDate = null, targets = DEFAULT_TARGETS,
                           unlinkedMeasureLines = [] }) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const raw = text.split(/\r?\n/);
  const unlinked = new Set(unlinkedMeasureLines);

  // 1. strip every owned line: all #"/#(agent)/#(doc) in a #(kp)-linked block,
  //    #(agent)/#(doc) above an unlinked measure, and (index.malloy only) every
  //    model-level ##"/##(agent)/##(doc).
  const drop = new Set();
  raw.forEach((line, i) => {
    if (isIndex && OWNED_MODEL.test(line)) drop.add(i);
    if (unlinked.has(i))
      for (let j = i - 1; j >= 0 && ANNOTATION.test(raw[j]); j--)
        if (OWNED.test(raw[j]) && !/^[ \t]*#"/.test(raw[j])) drop.add(j);
    if (!CONCEPT.test(line)) return;
    const { start, end } = blockAround(raw, i);
    for (let j = start; j <= end; j++) if (OWNED.test(raw[j])) drop.add(j);
  });
  const kept = raw.map((t, i) => ({ t, unlinked: unlinked.has(i) })).filter((_, i) => !drop.has(i));
  const lines = kept.map(k => k.t);

  // 2. regenerate.
  const out = [];
  const modelAt = isIndex ? Math.max(0, lines.findIndex(l => !/^##!/.test(l))) : -1;
  lines.forEach((line, i) => {
    if (i === modelAt) out.push(...emit({ instructions: modelRules(maxDate) }, '##', '', targets));
    if (kept[i].unlinked) out.push(...emit(UNLINKED_MEASURE, '#', /^[ \t]*/.exec(line)[0], targets));
    out.push(line);
    const m = CONCEPT.exec(line);
    if (!m || !canon[m[2]]) return;   // unknown URI: build.js's referential validation reports it
    const [, indent, uri] = m;
    const { decl } = blockAround(lines, i);
    const head = SOURCE_HEAD.exec(decl);
    if (/^\s*source:/.test(decl)) {
      // root sources only: a same-concept parent already hands these down
      const parent = head && graph[head[2]];
      if (parent && parent.concept === uri) return;
      out.push(...emit(sourceProjection(uri, canon[uri]), '#', indent, targets));
    } else {
      out.push(...emit(fieldProjection(uri, canon[uri]), '#', indent, targets));
    }
  });
  return out.join(eol);
}

function targetsFrom(env) {
  const t = (env || '').split(',').map(s => s.trim()).filter(Boolean);
  const bad = t.filter(x => !EMITTERS[x]);
  if (bad.length) throw new Error(`STAMP_TARGETS: unknown target(s) ${bad.join(', ')} (known: ${Object.keys(EMITTERS).join(', ')})`);
  return t.length ? t : DEFAULT_TARGETS;
}

module.exports = { stampText, sourceGraph, fieldProjection, sourceProjection, modelRules, targetsFrom, OWNED };
