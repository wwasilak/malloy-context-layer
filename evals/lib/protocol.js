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
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const PROTOCOL_FILE = 'CLAUDE.md';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// EVAL-15: the backup used to live at <repo-root>/CLAUDE.md.protocol-backup —
// inside the working tree the agent under test explores with Read/Glob. A
// stripped-protocol run left the real protocol one Read call away, and an
// agent that looked found it and followed it instead of the scratch prompt it
// was supposed to be limited to (confirmed live in the
// `top5-customers-category-nest` harvest run, 2026-08-06). Move it outside the
// tree, to a path keyed on the protocol file's own location — stable across
// runs of the SAME repo so a leftover from a crashed run is still findable by
// `guard()` below, but not discoverable by an agent that only explores the
// repo it was pointed at.
const defaultBackupFile = (protocolFile) =>
  path.join(os.tmpdir(), `malloy-kp-protocol-backup-${sha256(path.resolve(protocolFile)).slice(0, 16)}`);

// Refuse to start rather than risk someone's uncommitted protocol edits. A
// crash mid-run restores from the backup, but only if there was nothing in the
// working copy worth losing in the first place.
function guard({ protocolFile = PROTOCOL_FILE, backupFile = defaultBackupFile(protocolFile) } = {}) {
  if (fs.existsSync(backupFile))
    throw new Error(`${backupFile} already exists — a previous --protocol run did not clean up. Inspect it and restore ${protocolFile} manually.`);
  try {
    const dirty = execSync(`git status --porcelain -- ${protocolFile}`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    if (dirty)
      throw new Error(`${protocolFile} has uncommitted changes. Commit or stash them before a --protocol run — it moves the file aside for the duration of the run.`);
  } catch (e) {
    if (/uncommitted changes/.test(e.message)) throw e;
    // not a git repo, or git unavailable: backup+restore still protects the file
  }
}

// Put `path`'s content where the agent will discover it. Returns a restore
// function that is safe to call more than once (finally + a signal handler will
// both reach for it).
function swapIn(path, { protocolFile = PROTOCOL_FILE, backupFile = defaultBackupFile(protocolFile) } = {}) {
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

// EVAL-16: swapping CLAUDE.md is not enough. CLAUDE.md itself tells the agent
// to consult these operational docs ("check Standing hints before
// answering", "copy these query shapes" — see CLAUDE.md and EVAL-12b's own
// case_fingerprint reasoning, which already treats them as standing hints the
// agent acts on). They sit in the working tree the agent under test explores
// with plain Read/Glob access REGARDLESS of which CLAUDE.md is in force, so a
// stripped-protocol run that only swaps CLAUDE.md leaves the real, governed
// answers one Read call away — confirmed live: a stripped run answered
// `best-customer-ranking-criterion` almost verbatim off `corrections.md`
// (2026-08-06). A true "no protocol" control has to hide the whole
// operational apparatus, not just the file that names it.
const OPERATIONAL_DOCS = [
  path.join('kp', 'agent', 'corrections.md'),
  path.join('kp', 'agent', 'question-log.md'),
  path.join('kp', 'agent', 'gap-log.md'),
  path.join('kp', 'agent', 'examples.md'),
];

// Move `file` out of the way entirely — unlike swapIn there is no stripped
// replacement content for a standing-hints file, it should simply not exist
// for the duration of the run. A file that is not there to begin with is not
// hidden or restored; nothing to guard.
function hideFile(file, { backupFile = defaultBackupFile(file) } = {}) {
  if (!fs.existsSync(file)) return () => false;
  guard({ protocolFile: file, backupFile });

  fs.copyFileSync(file, backupFile);
  fs.unlinkSync(file);

  let done = false;
  return function restore() {
    if (done) return false;
    done = true;
    if (!fs.existsSync(backupFile)) return false;
    fs.copyFileSync(backupFile, file);
    fs.unlinkSync(backupFile);
    return true;
  };
}

// Hide every operational doc as ONE unit: guard all of them before hiding
// any, so a dirty-tree or leftover-backup problem on the third file cannot
// leave the first two already moved aside with no restore triggered yet.
function hideOperationalDocs(files = OPERATIONAL_DOCS) {
  const present = files.filter((f) => fs.existsSync(f));
  const backups = present.map((f) => defaultBackupFile(f));
  present.forEach((f, i) => guard({ protocolFile: f, backupFile: backups[i] }));
  present.forEach((f, i) => { fs.copyFileSync(f, backups[i]); fs.unlinkSync(f); });

  let done = false;
  return function restoreAll() {
    if (done) return false;
    done = true;
    let any = false;
    present.forEach((f, i) => {
      if (fs.existsSync(backups[i])) {
        fs.copyFileSync(backups[i], f);
        fs.unlinkSync(backups[i]);
        any = true;
      }
    });
    return any;
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

module.exports = {
  swapIn, guard, assertActive, hideFile, hideOperationalDocs, sha256,
  PROTOCOL_FILE, OPERATIONAL_DOCS, defaultBackupFile,
};
