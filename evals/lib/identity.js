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

// Deterministic digest of every file under dir: sorted "relpath:contenthash"
// lines, so a rename registers as a change just as an edit does.
function treeDigest(dir) {
  const walk = (d, base) =>
    fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
      if (e.name.startsWith('.')) return [];
      const p = path.join(d, e.name);
      if (e.isDirectory()) return walk(p, base);
      const rel = path.relative(base, p).split(path.sep).join('/');
      return [`${rel}:${sha256(fs.readFileSync(p))}`];
    });
  if (!fs.existsSync(dir)) return sha256('(absent)');
  return sha256(walk(dir, dir).sort().join('\n'));
}

function gitTree(ref) {
  try {
    return execSync(`git rev-parse HEAD:${ref}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
}

function gitDirty(paths) {
  try {
    const out = execSync(`git status --porcelain -- ${paths.join(' ')}`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    return out.length > 0;
  } catch {
    return null;
  }
}

// runtimeSettings: { malloy, duckdb, dialect, ... } from malloy.runtimeVersions()
function semanticIdentity({ kpDir = 'kp', modelsDir = 'models', runtimeSettings = {} } = {}) {
  const kp = treeDigest(kpDir);
  const models = treeDigest(modelsDir);
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

module.exports = { semanticIdentity, treeDigest, sha256 };
