/**
 * `pnpm lint` — the catch taxonomy (§13), enforced.
 *
 * Two classes of failure: operational (a timeout, an aborted navigation, a
 * detached element — expected, recoverable, becomes a gap) and everything else
 * (programming errors, which must always propagate). A `catch` that cannot tell
 * them apart converts a bug into missing data, and missing data is strictly
 * worse than a crash: a crash stops the run, missing data reports success and
 * poisons every stage downstream.
 *
 * That is not a hypothetical. A stray `probed += 1` left behind by an extraction
 * threw `ReferenceError` after a flow had been recorded, landed in a bare
 * `catch`, and every probe reported success while the code behind the throw
 * silently never ran.
 *
 * The rule: every `catch` binds an error, and its body either calls
 * `rethrowIfDefect` / `isOperationalError` or `throw`s. A `catch` that genuinely
 * wants to swallow must say so with `// operational:` and a reason — visible in
 * review, and greppable.
 *
 * Reports the number of catches examined, and the caller asserts it is non-zero.
 * A linter whose glob silently misses `.mjs` finds nothing and passes, which is
 * the vacuous-check failure this repo has now been bitten by three times.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Skipped by *name*, so only names that can never be source belong here.
 *
 * This list held `capture` and `envs` on its first run, to skip the artifact and
 * output directories — and skipped `packages/capture/` entirely, the third time
 * an unanchored name match has hidden the crawler from a tool in this repo. The
 * artifact directories are at the repo root and the roots below never descend
 * into them, so naming them here bought nothing and cost everything.
 */
const IGNORED_DIRS = new Set(['node_modules', 'dist', '.git', 'fixtures']);
const EXTENSIONS = ['.ts', '.mts', '.mjs', '.js'];

/** Every source file under `roots`, recursively. */
export function sourceFiles(repo, roots) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) walk(join(dir, entry.name));
        continue;
      }
      if (EXTENSIONS.some((ext) => entry.name.endsWith(ext))) found.push(join(dir, entry.name));
    }
  };
  for (const root of roots) {
    const abs = join(repo, root);
    try {
      if (statSync(abs).isDirectory()) walk(abs);
    } catch {
      // operational: a root that does not exist is not a lint failure; the
      // caller chooses the roots and one may legitimately be absent.
    }
  }
  return found.sort();
}

/**
 * Blank out strings, template literals and comments, keeping every offset.
 *
 * Without this the scanner matched the word `catch` inside its own error
 * message and reported itself. Characters are replaced one-for-one with spaces
 * so line numbers and brace matching stay exact.
 */
export function blankNonCode(text) {
  const out = text.split('');
  let i = 0;
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k += 1) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '/' && next === '/') {
      const end = text.indexOf('\n', i);
      blank(i, end === -1 ? text.length : end);
      i = end === -1 ? text.length : end;
    } else if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      blank(i, end === -1 ? text.length : end + 2);
      i = end === -1 ? text.length : end + 2;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      let k = i + 1;
      while (k < text.length) {
        if (text[k] === '\\') { k += 2; continue; }
        if (text[k] === ch) break;
        k += 1;
      }
      blank(i, k + 1);
      i = k + 1;
    } else {
      i += 1;
    }
  }
  return out.join('');
}

/** The body of the block starting at `open`, by brace matching. */
function blockAt(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return text.slice(open);
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** Lint one file's text. Returns `{ examined, violations }`. */
export function lintCatches(file, text) {
  const violations = [];
  let examined = 0;
  // Code positions come from the blanked copy; the excuse comment is read from
  // the original, because blanking removes comments by design.
  const code = blankNonCode(text);
  const re = /\bcatch\s*(\(([^)]*)\))?\s*\{/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    examined += 1;
    const binding = (m[2] ?? '').trim();
    const open = code.indexOf('{', m.index + 5);
    const body = blockAt(code, open);
    const line = lineOf(code, m.index);
    // The excuse may sit inside the body, or on the line above — a one-line
    // `} catch { return null; }` has nowhere to put a comment inside it.
    const bodyText = text.slice(open, open + body.length);
    const lineStart = text.lastIndexOf('\n', m.index) + 1;
    const prevStart = text.lastIndexOf('\n', lineStart - 2) + 1;
    const nearby = text.slice(prevStart, lineStart) + bodyText;
    const excused = /\/\/\s*operational:/.test(nearby);

    if (!binding) {
      if (excused) continue;
      violations.push({
        file, line,
        message: 'bare `catch {}` cannot tell a timeout from a ReferenceError. Bind the error and call rethrowIfDefect(err), or justify it with `// operational: <reason>`.',
      });
      continue;
    }
    const handles = /rethrowIfDefect|isOperationalError|\bthrow\b/.test(body);
    if (!handles && !excused) {
      violations.push({
        file, line,
        message: `catch (${binding}) swallows every error, defects included. Call rethrowIfDefect(${binding}) first, or justify it with \`// operational: <reason>\`.`,
      });
    }
  }
  return { examined, violations };
}

export function lintRepo(repo, roots = ['packages', 'scripts']) {
  let examined = 0;
  const violations = [];
  const files = sourceFiles(repo, roots);
  for (const file of files) {
    const result = lintCatches(relative(repo, file), readFileSync(file, 'utf8'));
    examined += result.examined;
    violations.push(...result.violations);
  }
  return { files: files.length, examined, violations };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repo = process.cwd();
  const { files, examined, violations } = lintRepo(repo);
  console.log(`\nlint:catch — ${examined} catch block(s) across ${files} source file(s)\n`);
  if (violations.length > 0) {
    for (const v of violations) console.log(`  ✗ ${v.file}:${v.line}\n      ${v.message}`);
    console.log(`\n✗ ${violations.length} catch block(s) can swallow a defect.`);
    process.exit(1);
  }
  console.log('✓ every catch distinguishes an operational failure from a defect.');
}
