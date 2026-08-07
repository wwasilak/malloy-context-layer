#!/usr/bin/env node
// =============================================================================
// migrate-okf-02.js — one-shot, re-runnable migration of kp/**.md concept
//   frontmatter to OKF v0.2 (SPEC.md). Line-based, not a full YAML re-serialize,
//   so untouched fields keep their exact formatting. Idempotent: a file that
//   already has `generated:` is left alone.
//
//   Per-file changes (only for concept files: type in entity|defined_class|
//   measure|attribute):
//     timestamp: X            -> generated: { by: <actor>, at: X }
//     status: approved        -> status: stable
//                                + verified: { by: <actor>, at: X }
//     approved_by: ...        -> removed (folded into verified.by)
//     tags: [..., approved]   -> tags: [...]              (drop the stale echo)
//   status: draft / deprecated is left as-is (same vocabulary in both OKF
//   versions); generated is still added so every concept gets provenance.
//
//   actor = human:<slug(steward)>, or human:global when no steward (global/).
//   Run: node migrate-okf-02.js [--dry-run]
// =============================================================================
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { actorFor } = require('./okf-slug'); // OKF-8: one shared slug, agrees with okf_slug.py

const KP_DIR = process.env.KP_DIR || 'kp';
const KINDS = new Set(['entity', 'defined_class', 'measure', 'attribute']);
const DRY = process.argv.includes('--dry-run');
const isoAt = (ts) => {
  const s = ts instanceof Date ? ts.toISOString().slice(0, 10) : String(ts);
  return s.includes('T') ? s : `${s}T00:00:00Z`;
};

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  if (e.name.startsWith('_') || e.name.startsWith('.')) return [];
  const p = path.join(d, e.name);
  if (e.isDirectory()) return walk(p);
  if (!e.name.endsWith('.md')) return [];
  return [p];
});

let touched = 0, skipped = 0, unchanged = 0;

for (const file of walk(KP_DIR)) {
  const raw = fs.readFileSync(file, 'utf8');
  const nl = raw.includes('\r\n') ? '\r\n' : '\n';
  let fm;
  try { fm = matter(raw); } catch { continue; }
  const d = fm.data;
  if (!KINDS.has(d.type)) continue; // operational doc, not a concept

  if (d.generated) { skipped++; continue; } // already migrated

  const actor = actorFor(d.steward);
  const at = isoAt(d.timestamp);
  const wasApproved = d.status === 'approved';

  // frontmatter block only: text between the two `---` fences (CRLF- or LF-terminated)
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!fmMatch) { console.warn(`  SKIP ${file}: no frontmatter fence found`); continue; }
  let block = fmMatch[1];
  const before = block;

  // timestamp -> generated
  block = block.replace(/^timestamp:[ \t]*(.+)$/m, `generated: { by: ${actor}, at: ${at} }`);

  if (wasApproved) {
    block = block.replace(/^status:[ \t]*approved[ \t]*$/m, 'status: stable');
    block = block.replace(/^generated: (.+)$/m,
      `generated: $1${nl}verified: { by: ${actor}, at: ${at} }`);
    block = block.replace(/^approved_by:.*\r?\n/m, '');
  }

  // tags: drop the trailing status echo, e.g. [Sales, approved] -> [Sales]
  block = block.replace(/^tags:[ \t]*\[(.+?)\][ \t]*$/m, (line, inner) => {
    const kept = inner.split(',').map((s) => s.trim()).filter((s) => s.toLowerCase() !== 'approved');
    return `tags: [${kept.join(', ')}]`;
  });

  if (block === before) { unchanged++; continue; }

  const next = raw.slice(0, fmMatch.index) + '---' + nl + block + nl + '---' + nl + raw.slice(fmMatch.index + fmMatch[0].length);
  if (DRY) {
    console.log(`  would update ${file}`);
  } else {
    fs.writeFileSync(file, next);
  }
  touched++;
}

console.log(`\n${DRY ? '[dry run] ' : ''}migrate-okf-02: ${touched} file(s) ${DRY ? 'would be' : ''} updated, ${skipped} already migrated, ${unchanged} needed no change.`);
