// =============================================================================
// stamp.js — surgical frontmatter edits on KP concept + eval case files.
//
//   Two writers need this: `last_validated` stamping after a passing run
//   (EVAL-3) and `expect_value` gold persistence (EVAL-1). Both edit ONE field
//   in an existing file.
//
//   Deliberately not gray-matter.stringify: round-tripping YAML reformats
//   quoting, key order and comments across the whole bundle, which would show
//   up as a huge diff and trip the OPS-1 "tree is dirty after build" gate for
//   reasons that have nothing to do with the change. Regex on the frontmatter
//   block only, leaving every other byte alone.
// =============================================================================
const fs = require('fs');

const FM_RE = /^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)/;

// Replace `key: value` inside the frontmatter, or append it if absent.
// Returns true when the file changed.
function setFrontmatterField(file, key, value) {
  const text = fs.readFileSync(file, 'utf8');
  const m = FM_RE.exec(text);
  if (!m) return false;

  const [, open, body, close] = m;
  const line = `${key}: ${value}`;
  // keep any trailing comment on the line we replace (cases use them as notes)
  const keyRe = new RegExp(`^${key}\\s*:.*$`, 'm');

  let nextBody;
  if (keyRe.test(body)) {
    nextBody = body.replace(keyRe, line);
  } else {
    nextBody = body.replace(/\s*$/, '') + '\n' + line;
  }
  if (nextBody === body) return false;

  fs.writeFileSync(file, open + nextBody + close + text.slice(m[0].length));
  return true;
}

function readFrontmatterField(file, key) {
  const text = fs.readFileSync(file, 'utf8');
  const m = FM_RE.exec(text);
  if (!m) return null;
  const line = new RegExp(`^${key}\\s*:\\s*(.*)$`, 'm').exec(m[2]);
  if (!line) return null;
  return line[1].replace(/#.*$/, '').trim();
}

module.exports = { setFrontmatterField, readFrontmatterField };
