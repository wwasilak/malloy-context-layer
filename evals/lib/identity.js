// =============================================================================
// identity.js — EVAL-6: the semantic identity hash.
//
//   A hash that identifies the MEANING a number was produced under: the plane's
//   content, the models that implement it, and the execution context. Stamped on
//   every result row so drift is diagnosable rather than mysterious:
//
//     same identity, different number -> the DATA moved   (expected on --live)
//     different identity              -> the MEANING moved (a kp/ or models/ edit)
//
//   We digest the WORKING TREE, not `git rev-parse HEAD:kp`. Evals are most
//   valuable on uncommitted edits — that is when someone is changing a
//   definition and wants to know what it breaks — and a committed-tree hash
//   would report the meaning of code that is not the code being tested. The git
//   tree shas are recorded alongside for provenance, with a dirty flag when the
//   two disagree.
// =============================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---- what does NOT count as meaning (EVAL-8) --------------------------------
// The runner writes back into the very tree it digests, so without these the
// hash changes after every successful sweep and the next report announces "the
// MEANING moved" when only a date moved — the exact false signal EVAL-6 exists
// to prevent.
//
//   last_validated  — stamped by run.js on a pass. Evidence that a definition
//                     was checked, not part of what it says.
//   gap-log         — a record that something is UNgoverned. Appending a gap
//   question-log      changes no governed definition; likewise a logged
//                     question. Both grow on ordinary use.
//
// Deliberately still IN: examples.md and corrections.md. Those are standing
// hints the agent reads and acts on — editing them can move a number, which is
// the definition of meaning changing.
const VOLATILE_FIELD_RE = /^[ \t]*last_validated[ \t]*:.*\r?\n?/gm;
const VOLATILE_FILES = ['agent/gap-log.md', 'agent/question-log.md'];
const TEXTUAL_RE = /\.(md|malloy|json|ya?ml|txt|csv)$/i;

// Digest one file's CONTENT as it bears on meaning. Binary (parquet) is hashed
// byte-for-byte; text has the volatile fields stripped first.
function fileDigest(p, rel, stripVolatile) {
  const buf = fs.readFileSync(p);
  if (!stripVolatile || !TEXTUAL_RE.test(rel)) return sha256(buf);
  return sha256(buf.toString('utf8').replace(VOLATILE_FIELD_RE, ''));
}

// Deterministic digest of every file under dir: sorted "relpath:contenthash"
// lines, so a rename registers as a change just as an edit does.
//
//   exclude       — dir-relative posix paths whose content is not meaning
//   stripVolatile — drop eval-runner-written fields before hashing text
function treeDigest(dir, { exclude = [], stripVolatile = false } = {}) {
  if (!fs.existsSync(dir)) return sha256('(absent)');
  const skip = new Set(exclude);

  const walk = (d, base) =>
    fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
      if (e.name.startsWith('.')) return [];
      const p = path.join(d, e.name);
      if (e.isDirectory()) return walk(p, base);
      const rel = path.relative(base, p).split(path.sep).join('/');
      if (skip.has(rel)) return [];
      return [`${rel}:${fileDigest(p, rel, stripVolatile)}`];
    });

  return sha256(walk(dir, dir).sort().join('\n'));
}

function gitTree(ref) {
  try {
    return execSync(`git rev-parse HEAD:${ref}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
}

// Dirty means "the working tree says something the last commit does not".
// Files whose content we exclude from the digest cannot make it dirty either,
// or the flag reports drift the hash deliberately ignores.
function gitDirty(paths) {
  try {
    const out = execSync(`git status --porcelain -- ${paths.join(' ')}`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    if (!out) return false;
    const ignored = new Set(VOLATILE_FILES.map((f) => `kp/${f}`));
    const changed = out.split('\n')
      .map((l) => l.slice(3).trim().replace(/^"|"$/g, ''))
      .filter((f) => !ignored.has(f));
    if (!changed.length) return false;
    // A file that differs ONLY by last_validated is stamped, not edited.
    return changed.some((f) => !stampOnlyChange(f));
  } catch {
    return null;
  }
}

// True when the only difference from HEAD is the eval runner's own stamp.
function stampOnlyChange(file) {
  try {
    const diff = execSync(`git diff HEAD -U0 -- "${file}"`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
    if (!diff.trim()) return false; // untracked or unreadable — treat as real
    const body = diff.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
    return body.length > 0 && body.every((l) => /^[+-][ \t]*last_validated[ \t]*:/.test(l));
  } catch {
    return false;
  }
}

// runtimeSettings: { malloy, duckdb, dialect, ... } from malloy.runtimeVersions()
function semanticIdentity({ kpDir = 'kp', modelsDir = 'models', runtimeSettings = {} } = {}) {
  const kp = treeDigest(kpDir, { exclude: VOLATILE_FILES, stripVolatile: true });
  const models = treeDigest(modelsDir, { stripVolatile: true });
  // CLAUDE.md is part of the meaning: it is the routing protocol the agent
  // applies. A change there can move every number without touching kp/.
  const protocol = fs.existsSync('CLAUDE.md') ? sha256(fs.readFileSync('CLAUDE.md')) : sha256('(absent)');
  const settings = JSON.stringify(runtimeSettings, Object.keys(runtimeSettings).sort());

  return {
    semantic_identity: 'sha256:' + sha256([kp, models, protocol, settings].join('|')),
    components: {
      kp_tree: kp,
      models_tree: models,
      protocol: protocol,          // CLAUDE.md
      runtime: runtimeSettings,
      git_kp_tree: gitTree(kpDir),
      git_models_tree: gitTree(modelsDir),
      dirty: gitDirty([kpDir, modelsDir, 'CLAUDE.md']),
    },
  };
}

module.exports = { semanticIdentity, treeDigest, sha256, VOLATILE_FILES };
