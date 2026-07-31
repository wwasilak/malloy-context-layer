// =============================================================================
// protocol.js — SIMP-5: run the suite against a DIFFERENT CLAUDE.md.
//
//   The harness's most valuable question is "does the protocol actually change
//   behaviour?", and the only honest way to ask it is to run the real cases
//   against a different protocol file and require the verdicts to move. That
//   means swapping the file the agent auto-discovers.
//
//   WHY A SWAP AND NOT INJECTION. Both lanes discover `CLAUDE.md` from the
//   working directory — tier 1 deliberately does it exactly as tier 2 does,
//   because "tier 1 differs from tier 2 in TOOLS and TURNS and nothing else" is
//   what makes the correlation check a comparison rather than two unrelated
//   measurements (EVAL-12a). Injecting a protocol into one lane and discovering
//   it in the other would break that. Injection also means `claude --bare`,
//   which forces API-key-only auth and breaks a local run on OAuth.
//
//   So: the file moves aside and comes back. This module is the whole of that
//   dance, in one place, with the ordering constraint it has to respect:
//
//   SWAP BEFORE THE IDENTITY IS COMPUTED. `CLAUDE.md` is inside
//   `semantic_identity` (EVAL-6) and inside every `case_fingerprint`
//   (EVAL-12b). Computing either one before the swap would stamp a
//   stripped-protocol run with the real protocol's identity — which would let
//   its rows sit in the ledger looking like evidence about the shipped product,
//   and `--select` would then skip a real case on the strength of a run that
//   deliberately used the wrong rules. `assertActive` exists to make that
//   ordering LOUD instead of silent; run.js calls it after computing identity.
// =============================================================================
const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');

const PROTOCOL_FILE = 'CLAUDE.md';
const BACKUP_FILE = 'CLAUDE.md.protocol-backup';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Refuse to start rather than risk someone's uncommitted protocol edits. A
// crash mid-run restores from the backup, but only if there was nothing in the
// working copy worth losing in the first place.
function guard({ protocolFile = PROTOCOL_FILE, backupFile = BACKUP_FILE } = {}) {
  if (fs.existsSync(backupFile))
    throw new Error(`${backupFile} already exists — a previous --protocol run did not clean up. Inspect it and restore ${protocolFile} manually.`);
  try {
    const dirty = execSync(`git status --porcelain -- ${protocolFile}`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    if (dirty)
      throw new Error(`${protocolFile} has uncommitted changes. Commit or stash them before a --protocol run — it rewrites the file.`);
  } catch (e) {
    if (/uncommitted changes/.test(e.message)) throw e;
    // not a git repo, or git unavailable: backup+restore still protects the file
  }
}

// Put `path`'s content where the agent will discover it. Returns a restore
// function that is safe to call more than once (finally + a signal handler will
// both reach for it).
function swapIn(path, { protocolFile = PROTOCOL_FILE, backupFile = BACKUP_FILE } = {}) {
  if (!fs.existsSync(path)) throw new Error(`--protocol file not found: ${path}`);
  guard({ protocolFile, backupFile });

  fs.copyFileSync(protocolFile, backupFile);
  fs.copyFileSync(path, protocolFile);

  let done = false;
  return function restore() {
    if (done) return false;
    done = true;
    if (!fs.existsSync(backupFile)) return false;
    fs.copyFileSync(backupFile, protocolFile);
    fs.unlinkSync(backupFile);
    return true;
  };
}

// The check that stops the ordering constraint above from failing silently:
// whatever the identity hashed had better be the protocol we swapped in.
function assertActive(path, protocolDigest, { protocolFile = PROTOCOL_FILE } = {}) {
  const want = sha256(fs.readFileSync(path));
  if (protocolDigest !== want)
    throw new Error(
      `--protocol did not take effect before the semantic identity was computed: ` +
      `identity hashed ${String(protocolDigest).slice(0, 12)}… but ${path} is ${want.slice(0, 12)}…. ` +
      `Results under a protocol swap MUST carry that protocol's identity, or they become ` +
      `evidence about a product that was never run (EVAL-6, EVAL-12b).`);
  return true;
}

module.exports = { swapIn, guard, assertActive, sha256, PROTOCOL_FILE, BACKUP_FILE };
